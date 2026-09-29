"""Analytic domains and inherited-boundary checks independent of constructors."""
import itertools
from pathlib import Path
import sys
import unittest

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from coverage_geometry import ordered_coverage
from vertex_partition import partition


class CoverageGeometryTests(unittest.TestCase):
    def test_point_and_line_contacts_not_material(self):
        full = box(0, 0, 1, 1)
        visible, hidden, ids = ordered_coverage(full, [('line', box(1,0,2,1)), ('point', box(1,1,2,2))])
        self.assertTrue(visible.equals(full))
        self.assertTrue(hidden.is_empty)
        self.assertEqual(ids, [])

    def test_tiny_real_overlap_is_never_thresholded(self):
        full = box(0,0,1,1)
        upper = box(1-2**-40,0,2,1)
        visible, hidden, ids = ordered_coverage(full, [('upper', upper)])
        self.assertEqual(ids, ['upper'])
        self.assertEqual(hidden.area, 2**-40)
        self.assertTrue(visible.union(hidden).equals(full))
        self.assertEqual(visible.intersection(hidden).area, 0)

    def test_actual_union_conservation_and_order_independence(self):
        full = box(0,0,10,10)
        uppers = [('a',box(1,1,6,4)), ('b',box(4,3,9,7))]
        expected = box(1,1,6,4).union(box(4,3,9,7))
        for order in itertools.permutations(uppers):
            v,h,ids = ordered_coverage(full, order)
            self.assertTrue(h.equals(expected))
            self.assertTrue(v.union(h).equals(full))
            self.assertEqual(v.intersection(h).area, 0)
            self.assertEqual(ids,['a','b'])

    def test_slanted_hole_partition_exact_boundary_and_vertices(self):
        outer = [(0.2,1.7),(9.3,.4),(11.6,8.9),(6.7,11.2),(1.1,9.8)]
        hole = [(2.23,3.18),(7.47,1.91),(9.37,7.86),(5.13,8.73)]
        source = Polygon(outer, [hole])
        pieces = partition(source)
        self.assertTrue(unary_union(pieces).equals(source))
        allowed = set(outer+hole)
        for p in pieces:
            self.assertFalse(p.interiors)
            self.assertTrue(set(p.exterior.coords) <= allowed)
        for a,b in itertools.combinations(pieces,2):
            self.assertEqual(a.intersection(b).area, 0)

    def test_small_hole_narrow_gap_and_remote_island_preserved(self):
        source = Polygon([(0,0),(3,0),(3,3),(0,3)], [[(1,1),(1+2**-30,1),(1+2**-30,2),(1,2)]])
        pieces = partition(source)
        self.assertTrue(unary_union(pieces).equals(source))
        island = box(4,0,4+2**-30,1)
        self.assertEqual(partition(island), (island,))
        v,h,ids = ordered_coverage(island, [(str(i),p) for i,p in enumerate(pieces)])
        self.assertTrue(v.equals(island))
        self.assertTrue(h.is_empty)


if __name__ == '__main__':
    unittest.main()
