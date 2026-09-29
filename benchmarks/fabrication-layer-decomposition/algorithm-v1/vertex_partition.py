"""Construction-only local common partition, preserving inherited vertices.

Keep an exactly reconstructible axis partition. Otherwise use two constrained
triangulation diagonals joining a hole to the shell. Both sides of every cut
reuse the same endpoints. No rounding, displaced source boundary, dropped
positive face or tolerance increase. Reread never invokes this constructor.
"""
from functools import lru_cache
from itertools import combinations

from shapely import constrained_delaunay_triangles
from shapely.geometry import LineString
from shapely.ops import unary_union, polygonize

from solid_plans import SolidPlanError, _parts, _require_polygon, _sort, decompose_solid

VERSION = 'inherited-vertex-hole-partition/1'


def _exact_partition(source, cells):
    return (bool(cells) and all(source.covers(p) for p in cells)
            and unary_union(cells).equals(source)
            and all(a.intersection(b).area == 0 for a,b in combinations(cells,2)))


@lru_cache(maxsize=64)
def partition(polygon, axis='x'):
    """Bounded pure geometry cache; keyed by complete immutable polygon/axis."""
    _require_polygon(polygon, 'vertex partition source')
    if not polygon.interiors:
        return (polygon,)
    old = decompose_solid(polygon, axis, clip_numeric_parts=True)
    if _exact_partition(polygon, old):
        return tuple(old)
    todo, completed = [polygon], []
    while todo:
        current = todo.pop(0)
        if not current.interiors:
            completed.append(current)
            continue
        shell = set(current.exterior.coords)
        holes = [set(r.coords) for r in current.interiors]
        by_hole = [set() for _ in holes]
        # CDT uses only original ring vertices. Its edges cannot cross a hole
        # or another triangulation edge. We use two diagonals, not its faces.
        for triangle in _parts(constrained_delaunay_triangles(current)):
            coords = list(triangle.exterior.coords)
            for a,b in zip(coords,coords[1:]):
                for i, vertices in enumerate(holes):
                    if (a in shell and b in vertices) or (b in shell and a in vertices):
                        by_hole[i].add(tuple(sorted((a,b))))
        choices=[]
        for edges in by_hole:
            for a,b in combinations(sorted(edges),2):
                first,second=LineString(a),LineString(b)
                choices.append((first.length+second.length,a,b))
        cells=None
        for _,a,b in sorted(choices):
            network=unary_union([current.boundary,LineString(a),LineString(b)])
            trial=_sort([p for p in polygonize(network) if current.covers(p.representative_point())])
            if (len(trial)>1 and sum(len(p.interiors) for p in trial)<len(current.interiors)
                    and _exact_partition(current,trial)):
                cells=trial
                break
        if cells is None:
            raise SolidPlanError('no exact inherited-vertex hole cut; source retained and rejected')
        todo.extend(cells)
    for p in completed:
        _require_polygon(p, 'inherited-vertex piece', solid=True)
    if not _exact_partition(polygon,completed):
        raise SolidPlanError('inherited-vertex partition changed source topology')
    return tuple(_sort(completed))
