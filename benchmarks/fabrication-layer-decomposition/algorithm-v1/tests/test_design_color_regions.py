"""Automatic proposals are tested without supplying the design answer."""
import json
from pathlib import Path
import sys
import unittest
import numpy as np
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[2]/'tools')]
import m4_runtime as kernel
from color_purification import assign_fringe_pixels
from design_color_regions import validate_request,estimate_palette,cleanup_foreground,rebuild_regions
from design_color_controls import control
from quality_fragments import _summary

CONFIG=kernel.load_profile('aggressive')[0]

def rebuild(rgba,reference=None,labels=None):
    request=validate_request(reference,'known control design' if reference else None)
    if labels is None: labels=kernel.get_candidate('CP-B').propose(rgba,CONFIG).structural_label_map
    pixels,_=assign_fringe_pixels(rgba,labels.astype(np.int32),CONFIG)
    return rebuild_regions(rgba,labels,pixels,CONFIG,request)

class DesignColorTests(unittest.TestCase):
    def test_repeated_exact_ink_details_survive_old_majority_coherence(self):
        body = [146, 76, 38]
        ink = [108, 48, 18]
        rgba = np.zeros((50, 90, 4), np.uint8)
        rgba[3:47, 3:87] = [*body, 255]
        marks = np.zeros(rgba.shape[:2], bool)
        for x in (12, 26, 40, 54, 68):
            marks[14:24, x:x+3] = True
        rgba[marks] = [*ink, 255]
        old = (rgba[..., 3] > 0).astype(np.int32)
        for reference in (None, [body, ink]):
            with self.subTest(reference=reference is not None):
                labels, _, report = rebuild(rgba, reference, old)
                self.assertNotEqual(labels[15,12], labels[15,20])
                self.assertTrue(np.all(labels[marks] != labels[15,20]))
                self.assertEqual(report['after']['components'], 6)

    def test_variable_count_and_reference_paths(self):
        for count in (5,6,9):
            rgba,truth,palette=control(count)
            for reference in (None,palette):
                with self.subTest(count=count,mode='AUTO' if reference is None else 'REFERENCE'):
                    labels,_,report=rebuild(rgba,reference)
                    self.assertEqual(report['actualUsedColorCount'],count)
                    for color in range(1,count+1):
                        self.assertEqual(len(np.unique(labels[truth==color])),1)
                    self.assertEqual(_summary(labels)['components'],_summary(truth)['components'])
                    self.assertEqual(len(np.unique([labels[truth==i][0] for i in range(1,count+1)])),count)
    def test_texture_tint_edge_preserve_frame_holes_and_details(self):
        for variant in ('texture','tint','edge'):
            rgba,truth,palette=control(6,variant)
            labels,_,report=rebuild(rgba)
            self.assertEqual(report['actualUsedColorCount'],6,variant)
            np.testing.assert_array_equal(labels>0,truth>0)
            self.assertEqual(labels[87,130],labels[23,110])
            self.assertTrue(np.all(labels[6:9,55:58]>0))
            self.assertTrue(np.all(labels[60:90,18]>0))
    def test_old_label_partition_is_not_truth(self):
        rgba,truth,palette=control(6)
        labels=np.where(truth>0,1,0).astype(np.int32)
        new,_,report=rebuild(rgba,palette,labels)
        self.assertEqual(report['before']['regions'],1)
        self.assertEqual(report['after']['regions'],6)
        fragmented=np.arange(truth.size,dtype=np.int32).reshape(truth.shape)+1
        fragmented[truth==0]=0
        # Fragmented stripes, rather than one slow label per pixel.
        fragmented=np.where(truth>0,(np.indices(truth.shape)[1]//5)+1,0).astype(np.int32)
        other,_,_=rebuild(rgba,palette,fragmented)
        np.testing.assert_array_equal(new,other)
    def test_cleanup_is_separate_conservative_and_unconfirmed(self):
        rgba,truth,_=control(6);original=rgba.copy()
        rgba[10,70]=[220,220,220,255]
        derived,record=cleanup_foreground(rgba,CONFIG,validate_request(),enabled=True)
        self.assertEqual(derived[10,70,3],0)
        self.assertEqual(record['manualConfirmation'],'NOT_CONFIRMED')
        self.assertTrue(np.all(derived[6:9,55:58,3]==255))
        np.testing.assert_array_equal(rgba[truth>0],original[truth>0])
        disabled,_=cleanup_foreground(rgba,CONFIG,validate_request(),enabled=False)
        np.testing.assert_array_equal(disabled,rgba)
    def test_single_novel_decoration_and_thin_black_are_not_area_deleted(self):
        rgba,truth,_=control(6);rgba[80,80,:3]=[130,43,185]
        labels,_,r=rebuild(rgba)
        self.assertEqual(r['actualUsedColorCount'],7)
        self.assertNotEqual(labels[80,80],labels[80,81])
    def test_request_validation_no_implicit_reference(self):
        for palette,source in ((None,'answer'),([],None),([[True,0,0]],'x'),([[1,2,3]],None),([[1,2,3],[1,2,3]],'x')):
            with self.assertRaises(ValueError): validate_request(palette,source)
    def test_exterior_transition_cannot_seed_false_light_design_islands(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((32,40,4),255,np.uint8);rgba[...,3]=0
        rgba[5:28,5:35]=[*brown,255];rgba[14:23,12:28]=[*cream,255]
        # A neutral/bright transition followed by a dark ringing row. These
        # samples describe a brown exterior edge, not an independent cream mark.
        rgba[5,10:16,:3]=[[255,250,226],[251,244,216],[244,235,204],[238,228,193],[217,203,168],[215,192,145]]
        rgba[6,10:16,:3]=[[226,211,178],[213,197,161],[204,185,145],[199,178,135],[196,172,126],[210,176,124]]
        labels,_,_=rebuild(rgba,[brown,cream])
        brown_id=labels[10,8];cream_id=labels[18,20]
        self.assertNotEqual(brown_id,cream_id)
        self.assertTrue(np.all(labels[5:8,10:16]==brown_id),labels[5:8,10:16].tolist())
        pixels,_=assign_fringe_pixels(rgba,labels,CONFIG)
        _,metadata=kernel.apply_representatives(rgba,labels,'RC-A',CONFIG,pixels)
        regions,_=kernel._runtime_regions(labels,metadata)
        vector_config=kernel.load_profile('aggressive')[1]
        graph,vector,attempted=kernel._vectorize(labels,rgba[...,3],'boundary-regression','aggressive',vector_config)
        candidates=kernel._observed_candidates('boundary-regression',graph,vector,regions,attempted)
        polygons=kernel.candidate_polygons(candidates,graph,vector,float(vector_config['bezier']['validationFlatnessPx']))
        self.assertTrue(all(item['polygon'].is_valid for item in polygons))
    def test_exact_single_pixel_design_mark_on_exterior_edge_is_preserved(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((32,40,4),255,np.uint8);rgba[...,3]=0
        rgba[5:28,5:35]=[*brown,255];rgba[14:23,12:28]=[*cream,255]
        rgba[5,20,:3]=cream
        labels,_,_=rebuild(rgba,[brown,cream])
        self.assertEqual(labels[5,20],labels[18,20])
        self.assertNotEqual(labels[5,20],labels[5,19])
    def test_uncertain_exterior_band_does_not_leave_unsupported_interior_islands(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((40,48,4),255,np.uint8);rgba[...,3]=0
        rgba[5:36,5:43]=[*brown,255];rgba[18:30,14:34]=[*cream,255]
        # Three-pixel transition, including a ringing sample. These do not
        # match either design ink. The third row lies beyond the old 2.5px
        # edge rule; topology/evidence, not a larger cutoff, must own it.
        rgba[5:8,10:14,:3]=np.array([[251,244,216],[244,235,204],[237,219,181]])[:,None,:]
        old=np.where(rgba[...,3]>0,1,0).astype(np.int32)
        old[18:30,14:34]=2;old[5:8,10:14]=3
        for reference in (None,[brown,cream]):
            labels,_,_=rebuild(rgba,reference,old)
            self.assertTrue(np.all(labels[5:8,10:14]==labels[12,10]))
            np.testing.assert_array_equal(labels>0,rgba[...,3]>0)

    def test_same_weak_color_interior_mark_and_exact_boundary_mark_are_preserved(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((40,48,4),255,np.uint8);rgba[...,3]=0
        rgba[5:36,5:43]=[*brown,255];rgba[18:30,14:34]=[*cream,255]
        rgba[7,12,:3]=cream  # one-pixel true ink, near the exterior
        rgba[12,12,:3]=[237,219,181]  # same ambiguous RGB, no exterior transition path
        rgba[11:14,37:40,3]=0  # real alpha hole must not be filled
        old=np.where(rgba[...,3]>0,1,0).astype(np.int32)
        old[18:30,14:34]=2;old[7,12]=3;old[12,12]=4
        labels,_,_=rebuild(rgba,[brown,cream],old)
        self.assertEqual(labels[7,12],labels[20,20])
        self.assertEqual(labels[12,12],labels[20,20])
        self.assertTrue(np.all(labels[11:14,37:40]==0))
    def test_supported_ink_in_transition_component_protects_whole_detail(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((40,48,4),255,np.uint8);rgba[...,3]=0
        rgba[5:36,5:43]=[*brown,255];rgba[18:30,14:34]=[*cream,255]
        rgba[5:8,10:14,:3]=np.array([[251,244,216],[244,235,204],[237,219,181]])[:,None,:]
        rgba[7,11,:3]=cream
        old=np.where(rgba[...,3]>0,1,0).astype(np.int32)
        old[18:30,14:34]=2;old[5:8,10:14]=3
        labels,_,_=rebuild(rgba,[brown,cream],old)
        self.assertTrue(np.all(labels[7,10:14]==labels[20,20]))

    def test_transition_reownership_is_not_limited_by_small_area_cutoff(self):
        brown=[229,180,124];cream=[254,249,200]
        rgba=np.full((40,60,4),255,np.uint8);rgba[...,3]=0
        rgba[5:36,5:55]=[*brown,255];rgba[18:30,14:34]=[*cream,255]
        rgba[5:8,10:34,:3]=np.array([[251,244,216],[244,235,204],[237,219,181]])[:,None,:]
        old=np.where(rgba[...,3]>0,1,0).astype(np.int32)
        old[18:30,14:34]=2;old[5:8,10:34]=3
        labels,_,report=rebuild(rgba,[brown,cream],old)
        self.assertTrue(np.all(labels[5:8,10:34]==labels[12,10]))
        self.assertGreater(report['exteriorTransitionReownedPixelCount'],16)
    def test_reproducible_no_input_mutation_and_serializable(self):
        rgba,_,_=control();original=rgba.copy()
        one=rebuild(rgba);two=rebuild(rgba)
        self.assertEqual(one[2],two[2]);json.dumps(one[2],allow_nan=False)
        np.testing.assert_array_equal(one[0],two[0]);np.testing.assert_array_equal(rgba,original)
    def test_close_design_inks_thin_border_true_hole_and_independent_decoration(self):
        palette=[[8,8,8],[182,44,48],[204,59,61],[254,249,200]]
        truth=np.zeros((64,80),np.int32)
        truth[5:59,5:75]=1  # one-pixel intentional black frame
        truth[6:58,6:74]=2;truth[6:58,40:74]=3  # close but abrupt design inks
        truth[20:30,15:25]=4;truth[1:3,15:17]=4  # disconnected small decoration
        truth[12:45,35]=1  # one-pixel internal line
        truth[35:40,50:55]=0  # a genuine hole, not a colour island
        rgba=np.full((*truth.shape,4),255,np.uint8);rgba[...,3]=np.where(truth>0,255,0)
        for index,rgb in enumerate(palette,1):rgba[truth==index,:3]=rgb
        for reference in (None,palette):
            with self.subTest(mode='AUTO' if reference is None else 'REFERENCE'):
                labels,_,report=rebuild(rgba,reference)
                self.assertEqual(report['actualUsedColorCount'],4)
                mapped=[]
                for tid in range(1,5):
                    assigned=np.unique(labels[truth==tid]);self.assertEqual(len(assigned),1)
                    mapped.append(int(assigned[0]))
                self.assertEqual(len(set(mapped)),4)
                np.testing.assert_array_equal(labels>0,truth>0)
                self.assertEqual(_summary(labels)['components'],_summary(truth)['components'])
                self.assertTrue(np.all(labels[35:40,50:55]==0))
    def test_invalid_labels_and_fringe_rejected(self):
        rgba,truth,palette=control()
        with self.assertRaises(ValueError): rebuild(rgba,palette,truth.astype(float))
        truth[20,20]=0
        with self.assertRaises(ValueError): rebuild(rgba,palette,truth)

if __name__=='__main__': unittest.main()
