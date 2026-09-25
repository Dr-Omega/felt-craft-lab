"""Exact walk re-encoding is not permission to repair crossing/overlapping solids."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image
from shapely.geometry import Polygon

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import m4_runtime  # initializes the existing frozen dependency search paths
from m4_checks import candidate_polygons

OUTER=[(0,0),(0,20),(20,20),(20,0),(0,0)]
PINCHED=[(10,10),(5,10),(5,5),(10,5),(10,10),(15,10),(15,15),(10,15),(10,10)]

def inputs(rings):
    refs=[{'edgeReferences':[{'edgeId':f'e{i}','direction':1}]} for i in range(len(rings))]
    component={'componentId':'c','outerRing':refs[0],'innerRings':refs[1:]}
    geometry={**component,'edgeIds':[f'e{i}' for i in range(len(rings))]}
    candidate={'candidateId':'observed','vectorRoute':'selected','sourceRegionId':1,
               'sourceComponentId':'c','observedGeometry':geometry,'representativeColor':{'rgb':[40,80,120]}}
    graph={'regions':[{'regionId':1,'components':[component]}]}
    vector={'route':'selected','geometry':[{'edgeId':f'e{i}','segments':[
        {'type':'LINE','p0':list(a),'p1':list(b)} for a,b in zip(r,r[1:])]} for i,r in enumerate(rings)]}
    return [candidate],graph,vector

class PointTouchMaterializationTests(unittest.TestCase):
    def test_design_color_runtime_materializes_true_pinched_holes_through_m7(self):
        from algorithm_runtime import run_algorithm
        from quality_binding import verify_quality_design
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);source=root/'input.png';output=root/'output'
            rgba=np.zeros((24,24,4),np.uint8);rgba[2:22,2:22]=[40,80,120,255]
            rgba[9,9]=rgba[10,10]=0
            Image.fromarray(rgba).save(source);before=source.read_bytes()
            report=run_algorithm(image_path=source,output_root=output,
                foreground_source='SYNTHETIC_PINCHED_TRUE_HOLES_CONTROL',quality_mode='design-colors')
            self.assertEqual(source.read_bytes(),before)
            self.assertEqual(report['rerenderChecks']['renderBackStatus'],'PASS')
            self.assertEqual(verify_quality_design(output/'m4')['status'],'PASS')
            design=json.loads((output/'m4/experimental-design.json').read_text('utf-8'))
            self.assertTrue(design['pointTouchMaterialization'])
            actual=np.asarray(Image.open(output/'rerender.png').convert('RGBA'))
            self.assertEqual(int(actual[9,9,3]),0)
            self.assertEqual(int(actual[10,10,3]),0)
            self.assertTrue(np.all(actual[3:8,3:8,3]==255))

    def test_exact_pinched_hole_cycles_keep_area_boundaries_and_true_holes(self):
        values=inputs([OUTER,PINCHED]);before=copy.deepcopy(values)
        with self.assertRaisesRegex(ValueError,'invalid selected-vector'):
            candidate_polygons(*values,0.05)
        result=candidate_polygons(*values,0.05,point_touch_cycles=True)[0]
        polygon=result['polygon']
        self.assertTrue(polygon.is_valid)
        self.assertEqual(polygon.area,350)
        self.assertEqual(len(polygon.interiors),2)
        expected=Polygon(OUTER,[PINCHED[:5],PINCHED[4:]])
        self.assertTrue(polygon.equals(expected))
        self.assertTrue(polygon.boundary.equals(Polygon(OUTER,[PINCHED]).boundary))
        self.assertTrue(result['boundaryProvenance']['pointTouchMaterialization']['directedSegmentsPreserved'])
        self.assertEqual(values,before)

    def test_ring_start_scale_translation_do_not_change_cycle_semantics(self):
        expected=None
        for shift in range(len(PINCHED)-1):
            ring=PINCHED[:-1];ring=ring[shift:]+ring[:shift];ring=ring+[ring[0]]
            transform=lambda r:[(2*x+31,2*y-7) for x,y in r]
            polygon=candidate_polygons(*inputs([transform(OUTER),transform(ring)]),0.05,
                                       point_touch_cycles=True)[0]['polygon']
            if expected is None:expected=polygon
            self.assertEqual(polygon.wkb,expected.wkb)
            self.assertEqual(polygon.area,1400)

    def test_crossing_overlap_spike_and_multiple_shells_still_reject(self):
        invalid=[
            [[(0,0),(0,20),(20,0),(20,20),(0,0)]],
            [OUTER,[(5,5),(13,5),(13,13),(5,13),(5,5)],[(10,10),(16,10),(16,16),(10,16),(10,10)]],
            [[(0,0),(0,20),(20,20),(20,0),(10,0),(10,-2),(10,0),(0,0)]],
            [[(0,0),(0,10),(10,10),(10,20),(20,20),(20,10),(10,10),(10,0),(0,0)]],
        ]
        for rings in invalid:
            with self.subTest(rings=rings),self.assertRaises(ValueError):
                candidate_polygons(*inputs(rings),0.05,point_touch_cycles=True)

    def test_valid_polygon_is_byte_exact_and_provenance_tampering_is_rejected(self):
        values=inputs([OUTER])
        old=candidate_polygons(*values,0.05)[0]
        new=candidate_polygons(*values,0.05,point_touch_cycles=True)[0]
        self.assertEqual(old,new)
        self.assertEqual(old['polygon'].wkb,new['polygon'].wkb)
        broken=inputs([OUTER,PINCHED]);broken[0][0]['observedGeometry']['innerRings']=[]
        with self.assertRaisesRegex(ValueError,'ring references'):
            candidate_polygons(*broken,0.05,point_touch_cycles=True)

if __name__=='__main__':unittest.main()
