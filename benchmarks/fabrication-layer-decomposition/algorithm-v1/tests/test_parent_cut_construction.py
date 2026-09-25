"""Construction-side containment must not weaken actual-parent/source gates."""
import copy
from pathlib import Path
import sys
import unittest

from shapely.affinity import rotate, translate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solid_plans import decompose_solid, propose_plans, rank_plans, validate_plan


def domains(angle=7,offset=0.3):
    outer=translate(rotate(box(0,0,12,12),angle,origin=(0,0)),offset,-offset)
    inner=translate(rotate(box(3,3,7,7),angle,origin=(0,0)),offset,-offset)
    ring=outer.difference(inner)
    observed=[{'id':'ring','componentId':'ring','regionId':'red','colorSlotId':'red',
               'rgb':[180,30,40],'polygon':ring,'boundaryProvenance':{'source':'shared-control'}},
              {'id':'detail','componentId':'detail','regionId':'blue','colorSlotId':'blue',
               'rgb':[30,70,180],'polygon':inner,'boundaryProvenance':{'source':'shared-control'}}]
    return outer,ring,inner,observed


class ParentCutConstructionTests(unittest.TestCase):
    def test_parent_clipping_preserves_hole_and_excludes_neighbor_without_epsilon(self):
        for angle in (7,13,31):
            for axis in ('x','y'):
                with self.subTest(angle=angle,axis=axis):
                    outer,source,neighbor,_=domains(angle)
                    before=source.wkb
                    pieces=decompose_solid(source,axis,clip_numeric_parts=True)
                    self.assertEqual(source.wkb,before)
                    self.assertTrue(all(p.is_valid and not p.interiors for p in pieces))
                    self.assertTrue(all(p.difference(source).area==0 for p in pieces))
                    self.assertTrue(all(p.intersection(neighbor).area==0 for p in pieces))
                    reconstructed=unary_union(pieces)
                    self.assertLessEqual(reconstructed.symmetric_difference(source).area,1e-10)
                    self.assertLessEqual(reconstructed.boundary.hausdorff_distance(source.boundary),1e-10)
                    self.assertGreater(outer.area-reconstructed.area,neighbor.area-1e-10)

    def test_public_proposal_and_ranking_keep_source_and_seam_validation(self):
        _,_,_,sources=domains()
        before=copy.deepcopy(sources)
        plans=rank_plans(sources,propose_plans(sources,reject_invalid_options=True,clip_numeric_parts=True))
        self.assertTrue(plans)
        for plan in plans:
            checks=validate_plan(sources,plan)
            self.assertTrue(checks)
            for piece in plan['pieces']:
                if piece['role']=='VISIBLE':
                    owner=next(s for s in sources if s['componentId']==piece['sourceComponentIds'][0])
                    self.assertEqual(piece['polygon'].difference(owner['polygon']).area,0)
        self.assertEqual(sources,before)
        corrupted=copy.deepcopy(plans[0]);corrupted['pieces'][0]['sourceComponentIds']=[]
        with self.assertRaises(ValueError):rank_plans(sources,[corrupted])

    def test_default_and_no_cut_outputs_remain_exact_and_flag_is_strict(self):
        polygon=box(0,0,10,10)
        self.assertEqual(decompose_solid(polygon)[0].wkb,decompose_solid(polygon,clip_numeric_parts=True)[0].wkb)
        _,source,_,_=domains()
        self.assertEqual([p.wkb for p in decompose_solid(source)],
                         [p.wkb for p in decompose_solid(source,clip_numeric_parts=False)])
        with self.assertRaises(ValueError):decompose_solid(source,clip_numeric_parts=1)
        with self.assertRaises(ValueError):propose_plans(domains()[3],clip_numeric_parts='yes')


if __name__=='__main__':unittest.main()
