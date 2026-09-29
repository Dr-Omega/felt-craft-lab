from pathlib import Path
import sys
import unittest
import numpy as np
from scipy import ndimage

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT.parent/'tools')]
from transition_bands import compare_bands, PARAMETERS
from practical_selection import _edge_steps
from design_color_regions import _lab, digest
from quality_fragments import _components


def scene(plateau=False, hole=False, thin=False):
    # Weak labels between two supported faces; no reference answer reaches API.
    rgb=np.zeros((24,40,3),np.uint8)
    aa=np.array([70,110,170]);bb=np.array([190,170,70])
    rgb[:,:16]=aa;rgb[:,24:]=bb
    for x in range(16,24):rgb[:,x]=np.rint(aa+(0.5 if plateau else (x-15)/9)*(bb-aa))
    nearest=np.zeros((24,40),np.int32);nearest[:,24:]=1
    nearest[:,16:20]=2;nearest[:,20:24]=3
    active=np.ones((24,40),bool)
    if hole:active[:,19]=False
    markers=np.zeros_like(nearest);markers[:,:16]=1;markers[:,24:]=2
    selected=np.where(active,nearest+1,0).astype(np.int32)
    evidence=[]
    for idx in np.unique(nearest[active]):
        n,_,stats,_=_components(active&(nearest==idx))
        for cid in range(1,n):
            x,y,w,h,area=map(int,stats[cid])
            evidence.append({'designLabel':int(idx+1),'bbox':[x,y,w,h],'areaPixels':area,
                             'surfaceCore':idx<2,'coherentDetail':thin and idx>=2,
                             'independentForeground':False})
    return rgb,active,nearest,markers,_edge_steps(_lab(rgb),active),selected,evidence


class TransitionBandTests(unittest.TestCase):
    def test_joint_multiple_weak_bands_solved_actual_bounded_candidates(self):
        args=scene();labels,report=compare_bands(*args)
        self.assertEqual(set(np.unique(labels)),{1,2})
        self.assertEqual(report['selected'],'TWO_SIDE')
        self.assertEqual(len(report['candidates']),3)
        self.assertLessEqual(report['globalSampleCount'],PARAMETERS['maxGlobalCrossSections'])
        self.assertEqual(labels[12,18],1);self.assertEqual(labels[12,22],2)
        for row in report['candidates']:
            rebuilt=args[5].copy()
            for y,x0,x1,label in row['changesYXRangeLabel']:rebuilt[y,x0:x1]=label
            self.assertEqual(digest(rebuilt),row['labelsSha256'])
            self.assertEqual(row['protectedStructureChanged'],0)

    def test_true_midcolor_plateau_is_not_just_a_mixture(self):
        args=scene(plateau=True);labels,report=compare_bands(*args)
        np.testing.assert_array_equal(labels,args[5])
        self.assertTrue(any(r['independentPlateau'] for r in report['sampledCrossSections']))

    def test_cannot_borrow_contrast_across_alpha_hole_or_protected_detail(self):
        for args in (scene(hole=True),scene(thin=True)):
            labels,report=compare_bands(*args)
            np.testing.assert_array_equal(labels,args[5])
            self.assertEqual(report['supportedTransitionPixels'],0)

    def test_transparent_rgb_not_observed(self):
        args=list(scene(hole=True));first=compare_bands(*args)
        args[0]=args[0].copy();args[0][~args[1]]=[255,0,255]
        second=compare_bands(*args)
        np.testing.assert_array_equal(first[0],second[0]);self.assertEqual(first[1],second[1])

    def test_small_color_shift_and_scale_keep_geometry_of_band_decision(self):
        for scale in (1,2):
            for shift in (0,3):
                args=list(scene());args[0]=args[0]+shift
                for i in range(6):args[i]=np.repeat(np.repeat(args[i],scale,axis=0),scale,axis=1)
                for row in args[6]:
                    row['bbox']=[v*scale for v in row['bbox']]
                    row['areaPixels']*=scale**2
                result,_=compare_bands(*args)
                self.assertEqual(set(np.unique(result)),{1,2})


if __name__=='__main__':unittest.main()
