"""Domain identity tests: coordinates are synthetic, not real-case exceptions."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2]/'tools')]
from component_binding import bind_components, verify_persisted_binding, raster_domains
import m4_runtime as kernel
from m1_adapter import artifact, build_input, canonical_bytes


def fixture(labels):
    alpha=np.where(labels>0,255,0).astype(np.uint8)
    config=kernel.load_profile('aggressive')[1]
    graph,vector,routes=kernel._vectorize(labels,alpha,'binding-test','aggressive',config)
    metadata=[{'regionId':int(r),'representativeColorRgb':[100,80,50], 'representativeColorLab':[40,2,10]}
              for r in np.unique(labels) if r>0]
    regions,_=kernel._runtime_regions(labels,metadata)
    return graph,vector,routes,regions


class ComponentBindingTests(unittest.TestCase):
    def labels(self):
        labels=np.zeros((18,24),np.int32)
        labels[2:5,17:21]=1
        labels[12:15,2:6]=1
        return labels

    def test_opposite_sort_orders_bind_equal_area_spatially_distinct_domains(self):
        labels=self.labels();graph,_,_,regions=fixture(labels)
        bound,proof=bind_components(labels,graph,regions)
        self.assertEqual([c['rasterScanOrdinal'] for c in bound[0]['components']],[2,1])
        self.assertEqual(bound[0]['components'][0]['bbox'],[2,12,4,3])
        self.assertEqual(len({r['pixelDomainSha256'] for r in proof['components']}),2)
        self.assertEqual([r['area'] for r in proof['components']],[12,12])

    def test_list_permutations_do_not_change_binding(self):
        labels=self.labels();labels[7:9,10:12]=2
        graph,_,_,regions=fixture(labels)
        expected=bind_components(labels,graph,regions)
        graph['regions'].reverse();graph['edges'].reverse();regions.reverse()
        for r in graph['regions']:r['components'].reverse()
        for r in regions:r['components'].reverse()
        self.assertEqual(bind_components(labels,graph,regions),expected)

    def test_holes_and_point_contacts_preserve_complete_directed_domain(self):
        labels=np.ones((12,12),np.int32);labels[[0,-1],:]=0;labels[:,[0,-1]]=0
        labels[3:5,3:5]=0;labels[5:7,5:7]=0
        graph,_,_,regions=fixture(labels)
        bound,proof=bind_components(labels,graph,regions)
        self.assertEqual(sum(c['area'] for c in proof['components']),int(np.count_nonzero(labels)))
        self.assertEqual(len(bound[0]['components']),1)

    def test_diagonal_foreground_pixels_remain_separate_four_connected_domains(self):
        labels=np.zeros((6,6),np.int32);labels[2,2]=1;labels[3,3]=1
        graph,_,_,regions=fixture(labels)
        self.assertEqual(len(bind_components(labels,graph,regions)[1]['components']),2)

    def test_missing_duplicate_and_cross_region_components_rejected(self):
        labels=self.labels();labels[7:9,10:12]=2
        graph,_,_,regions=fixture(labels)
        for mutation in ('missing','duplicate','cross-region'):
            with self.subTest(mutation=mutation):
                changed=deepcopy(graph)
                if mutation=='missing':changed['regions'][0]['components'].pop()
                elif mutation=='duplicate':changed['regions'][0]['components'].append(deepcopy(changed['regions'][0]['components'][0]))
                else:changed['regions'][0]['components'][0]['outerRing']['regionId']=2
                with self.assertRaisesRegex(ValueError,'Component binding'):
                    bind_components(labels,changed,regions)

    def test_equal_area_bbox_is_not_a_domain_proof(self):
        labels=self.labels();graph,_,_,regions=fixture(labels)
        changed=deepcopy(graph)
        # Move a raw grid vertex while leaving all declared statistics/IDs intact.
        edge=changed['edges'][0];edge['geometry'][0][0]+=1
        with self.assertRaisesRegex(ValueError,'Component binding'):
            bind_components(labels,changed,regions)

    def test_numbered_preview_uses_bound_domain_not_list_position(self):
        labels=self.labels();graph,_,_,regions=fixture(labels)
        bound,_=bind_components(labels,graph,regions)
        with patch.object(kernel.ImageDraw.ImageDraw,'text') as draw:
            kernel._numbered_preview(labels,components=True,regions=bound)
        positions={call.args[1]:call.args[0] for call in draw.call_args_list}
        self.assertEqual(positions[bound[0]['components'][0]['componentId']],(3,13))
        self.assertEqual(positions[bound[0]['components'][1]['componentId']],(18,3))

    def test_all_public_m4_quality_paths_persist_verified_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source.png'
            rgba=np.zeros((64,72,4),np.uint8)
            rgba[4:20,46:62]=[180,75,35,255];rgba[40:56,4:20]=[180,75,35,255]
            Image.fromarray(rgba).save(source)
            for mode in ('baseline','selection','contour','combined','design-colors','design-cleanup'):
                with self.subTest(mode=mode):
                    out=root/mode
                    kernel.run_runtime(image_path=source,output_root=out,mode='embedded-alpha',
                                       foreground_source='TEST',manual_confirmation='PENDING_REVIEW',profile='aggressive',
                                       mask_path=None,runtime_id='binding-test',quality_mode=mode)
                    verify_persisted_binding(out);build_input(out)

    def test_public_runtime_and_rehashed_wrong_mapping_rejected_by_m1(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source.png';out=root/'runtime'
            labels=self.labels();rgba=np.zeros((*labels.shape,4),np.uint8);rgba[labels>0]=[100,80,50,255]
            Image.fromarray(rgba).save(source)
            kernel.run_runtime(image_path=source,output_root=out,mode='embedded-alpha',
                               foreground_source='TEST',manual_confirmation='PENDING_REVIEW',profile='aggressive',
                               mask_path=None,runtime_id='binding-test',quality_mode='design-colors')
            verify_persisted_binding(out);original_input=build_input(out)
            read=lambda name:json.loads((out/name).read_text())
            regions=read('regions.json');proof=read('component-binding.json')
            components=regions[0]['components'];self.assertEqual(len(components),2)
            fields=('area','bbox','pixelDomainSha256','rasterScanOrdinal')
            for field in fields:
                components[0][field],components[1][field]=components[1][field],components[0][field]
                proof['components'][0][field],proof['components'][1][field]=proof['components'][1][field],proof['components'][0][field]
            for name,value in [('regions.json',regions),('component-binding.json',proof)]:
                (out/name).write_bytes(canonical_bytes(value))
            observed=read('observed-candidates.json')
            for c in observed:
                c['sourcePixelDomainSha256']=next(r['pixelDomainSha256'] for r in components if r['componentId']==c['sourceComponentId'])
            (out/'observed-candidates.json').write_bytes(canonical_bytes(observed))
            report=read('report.json');report['componentBinding']['sha256']=hashlib.sha256((out/'component-binding.json').read_bytes()).hexdigest()
            identity=read('algorithm-identity.json');identity['componentBinding']=report['componentBinding']
            (out/'algorithm-identity.json').write_bytes(canonical_bytes(identity))
            report['algorithmIdentity']=hashlib.sha256(canonical_bytes(identity)).hexdigest()
            for name in report['artifactSha256']:
                report['artifactSha256'][name]=hashlib.sha256((out/name).read_bytes()).hexdigest()
            (out/'report.json').write_bytes(canonical_bytes(report))
            with self.assertRaisesRegex(ValueError,'actual pixel domain'):build_input(out)
            # Final persisted replay must reject even when every input artifact
            # digest is recomputed. No stale-hash failure is used as the oracle.
            from algorithm_runtime import _verify_artifacts
            # The final verifier expects M4 in output/m4; rename only this test's
            # disposable runtime, never a user worktree.
            final=root/'final';final.mkdir();out.rename(final/'m4')
            original_input['artifacts']=[artifact(final/'m4'/r['id'],r['id'],r['mediaType'])
                                         for r in original_input['artifacts']]
            with self.assertRaisesRegex(ValueError,'actual pixel domain'):
                _verify_artifacts(final,original_input,None)

    def test_old_hash_valid_runtime_without_binding_not_accepted(self):
        from test_m1_adapter import M1AdapterTests
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);M1AdapterTests().make_runtime(root)
            (root/'component-binding.json').unlink()
            with self.assertRaises(FileNotFoundError):build_input(root)


if __name__=='__main__':unittest.main()
