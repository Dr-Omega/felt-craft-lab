"""Paired spatial evidence, not real-image identity or expected runtime counts."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from scipy import ndimage

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT.parent/'tools')]
import m4_runtime as runtime
from practical_candidates import boundary_pairs, compare_ownership, PARAMETERS
from practical_selection import _edge_steps, rebuild_regions
from practical_cleanup import cleanup_foreground
from design_color_regions import _lab, validate_request
from color_purification import assign_fringe_pixels

CONFIG=runtime.load_profile('aggressive')[0]


def select(rgba):
    proposal=runtime.get_candidate('CP-B').propose(rgba,CONFIG)
    return rebuild_regions(rgba,proposal.structural_label_map,proposal.pixel_label_map,CONFIG,validate_request())


def pair_scene(gradual=False):
    colors=np.array([[180,90,100],[205,112,122]],np.float32)
    rgb=np.empty((64,96,3),np.uint8)
    rgb[:,:48]=colors[0];rgb[:,48:]=colors[1]
    if gradual:
        for x in range(24,72): rgb[:,x]=np.rint(colors[0]+(x-23)/49*(colors[1]-colors[0]))
    active=np.ones((64,96),bool)
    dist=np.stack([np.linalg.norm(_lab(rgb)-c,axis=2) for c in _lab(colors)])
    nearest=dist.argmin(0).astype(np.int32)
    markers=np.zeros(active.shape,np.int32)
    markers[8:-8,8:16]=1;markers[8:-8,-16:-8]=2
    return rgb,active,colors,nearest,markers,_edge_steps(_lab(rgb),active)


class PracticalCandidateTests(unittest.TestCase):
    def test_actual_source_boundary_distinguishes_close_surfaces_from_smooth_texture(self):
        sharp=compare_ownership(*pair_scene())
        texture=compare_ownership(*pair_scene(True))
        self.assertEqual(len(np.unique(sharp[0])),2)
        self.assertEqual(len(np.unique(texture[0])),1)
        self.assertTrue(any(r['selected']=='MERGE_DIFFUSE_INTERFACE' for r in texture[2]['paletteComparisons']))
        self.assertFalse(any(r['selected']=='MERGE_DIFFUSE_INTERFACE' for r in sharp[2]['paletteComparisons']))

    def test_marker_numbers_are_not_confidence_or_priority(self):
        args=pair_scene()
        first=compare_ownership(*args)[0]
        rgb,active,colors,nearest,markers,grad=args
        swapped=np.where(markers>0,3-markers,0).astype(np.int32)
        second=compare_ownership(rgb,active,colors[::-1],1-nearest,swapped,grad)[0]
        np.testing.assert_array_equal(first,3-second)

    def test_lost_supported_face_triggers_bounded_feedback_not_only_warning(self):
        rgb,active,colors,nearest,markers,grad=pair_scene()
        markers[markers==2]=0
        labels,_,report=compare_ownership(rgb,active,colors,nearest,markers,grad)
        self.assertEqual(labels[32,78],2)
        self.assertGreater(report['structureLossFeedback'][0]['missingSupportedCorePixels'],0)
        self.assertLessEqual(len(report['structureLossFeedback']),PARAMETERS['maximumFeedbackRounds'])
        self.assertNotEqual(report['baselineCandidateSha256'],report['selectedCandidateSha256'])

    def test_real_dot_and_thin_dark_stroke_survive_without_thick_seed_core(self):
        rgba=np.zeros((72,96,4),np.uint8)
        rgba[6:66,6:90]=[208,155,130,255]
        rgba[12:58,40]=[12,18,22,255]
        rgba[28:31,65:68]=[35,45,70,255]
        for scale in (1,2):
            for shift in (0,3):
                image=np.repeat(np.repeat(rgba,scale,axis=0),scale,axis=1)
                active=image[...,3]>0
                image[active,:3]+=shift
                labels,_,_=select(image)
                self.assertNotEqual(labels[30*scale,40*scale],labels[30*scale,32*scale])
                self.assertNotEqual(labels[29*scale,66*scale],labels[29*scale,60*scale])
                np.testing.assert_array_equal(labels>0,active)

    def test_boundary_ramp_is_not_a_new_thin_ink(self):
        rgb,active,colors,nearest,markers,grad=pair_scene()
        # A third ink happens to equal transition samples; it is not a new
        # authored stripe solely because the histogram has matching pixels.
        middle=np.rint((colors[0]+colors[1])/2)
        colors=np.vstack((colors,middle))
        rgb[:,47:49]=middle
        nearest[:,47:49]=2
        # No seed claims for the unresolved transition; real flank seeds stay.
        labels,_,_=compare_ownership(rgb,active,colors,nearest,markers,_edge_steps(_lab(rgb),active))
        self.assertFalse(np.any(labels==3))

    def test_transparent_rgb_and_true_holes_do_not_change_candidates(self):
        rgba=np.zeros((72,96,4),np.uint8)
        rgba[8:65,9:85]=[210,80,65,255]
        rgba[20:32,21:34]=[240,204,80,255]
        rgba[41:52,52:64]=0
        changed=rgba.copy()
        rng=np.random.default_rng(33)
        hidden=changed[...,3]==0
        changed[hidden,:3]=rng.integers(0,256,(int(hidden.sum()),3),dtype=np.uint8)
        a,b=select(rgba),select(changed)
        np.testing.assert_array_equal(a[0],b[0]);self.assertEqual(a[2],b[2])
        self.assertFalse(np.any(a[0][41:52,52:64]))

    def test_distant_isolated_color_sample_does_not_veto_local_residue_evidence(self):
        rgba=np.zeros((80,100,4),np.uint8)
        rgba[12:66,12:70]=[30,80,160,255]
        rgba[12:66,69]=[150,100,100,255]
        rgba[40,72]=[151,101,99,255]
        rgba[25,25:28]=[151,101,99,255]
        cleaned,report=cleanup_foreground(rgba,enabled=True)
        self.assertEqual(cleaned[40,72,3],0)
        np.testing.assert_array_equal(cleaned[25,25:28],rgba[25,25:28])
        self.assertEqual(report['trustedBodyPixelsChanged'],0)
        # In the paired scene there really is a coherent authored matching ink.
        rgba[25:28,25:28]=[151,101,99,255]
        preserved,_=cleanup_foreground(rgba,enabled=True)
        self.assertEqual(preserved[40,72,3],255)

    def test_candidate_recipe_is_independently_rebuilt_and_bounds_are_explicit(self):
        args=pair_scene()
        before=PARAMETERS.copy()
        out=compare_ownership(*args)
        self.assertFalse(out[2]['qualityProxyIsHumanTruth'])
        self.assertFalse(out[2]['confidenceUsesMarkerOrdinal'])
        self.assertTrue(all(len(r['alternatives'])==2 for r in out[2]['domainComparisons']))
        self.assertEqual(PARAMETERS,before)
        out[2]['parameters']['boundarySamplingRadiiPx'].append(99)
        self.assertNotIn(99,PARAMETERS['boundarySamplingRadiiPx'])

    def test_boundary_probe_cannot_jump_third_ink_or_transparent_gap(self):
        rgb,active,colors,nearest,markers,grad=pair_scene()
        nearest[:,45]=2
        pairs=boundary_pairs(_lab(rgb),nearest,active,4)
        self.assertFalse(any(np.any((xx==47)&(left==0)&(right==1)) for _,xx,_,left,right,_ in pairs))
        nearest[:,45]=0
        active[:,45]=False
        pairs=boundary_pairs(_lab(rgb),nearest,active,4)
        self.assertFalse(any(np.any((xx==47)&(left==0)&(right==1)) for _,xx,_,left,right,_ in pairs))

    def test_sharp_interface_blocks_transitive_diffuse_color_merge(self):
        rgb,active,colors,nearest,markers,grad=pair_scene()
        colors=np.asarray([[150,95,100],[158,103,108],[166,111,116]],np.float32)
        nearest[:,:32]=0;nearest[:,32:64]=1;nearest[:,64:]=2
        markers=np.zeros_like(nearest);markers[:,8]=1;markers[:,48]=2;markers[:,80]=3
        # Isolate adjacency logic with two diffuse edges and one sharp edge.
        def probes(lab,labels,mask,radius):
            n=10
            return [(np.zeros(n*3,dtype=int),np.zeros(n*3,dtype=int),0,
                     np.repeat([0,1,0],n),np.repeat([1,2,2],n),np.repeat([0.,0.,20.],n))]
        with patch('practical_candidates.boundary_pairs',side_effect=probes):
            report=compare_ownership(rgb,active,colors,nearest,markers,grad)[2]
        self.assertLessEqual(sum(r['selected']=='MERGE_DIFFUSE_INTERFACE' for r in report['paletteComparisons']),1)


if __name__=='__main__': unittest.main()
