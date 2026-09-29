"""Pure ordered polygonal coverage; no source declarations or cached verdicts.

The narrow phase is the actual pairwise intersection, never intersection with
an already rounded union of unrelated upper boundaries. No minimum area is
used: every representable positive polygon survives, and contact lines do not
become material. Readers reconstruct from full persisted operands.
"""
from shapely.geometry import Polygon
from shapely.ops import unary_union

from solid_plans import _parts

VERSION = 'pairwise-ordered-coverage/1'


def ordered_coverage(full, upper):
    """Return (visible, hidden, sorted occluders) for (identity, full) uppers."""
    intersections, occluders = [], []
    x0, y0, x1, y1 = full.bounds
    for identity, geometry in sorted(upper, key=lambda item: item[0]):
        a0, b0, a1, b1 = geometry.bounds
        if max(x0, a0) >= min(x1, a1) or max(y0, b0) >= min(y1, b1):
            continue
        parts = [p for p in _parts(full.intersection(geometry)) if p.area > 0]
        if parts:
            intersections.extend(parts)
            occluders.append(identity)
    if not intersections:
        return full, Polygon(), []
    hidden = unary_union(intersections)
    visible = unary_union(_parts(full.difference(hidden)))
    return visible, hidden, occluders
