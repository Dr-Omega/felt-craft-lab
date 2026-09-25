"""Opt-in design-colour inference and spatial resegmentation, not frozen CP-B.

Palette identity is global; geometry remains the actual 4-connected support.
There is no filename, fixture identity, expected colour count or target shape
input. Exterior residue is a separate, explicitly unconfirmed hypothesis.
"""
from __future__ import annotations

import copy
import hashlib

import cv2
import numpy as np
from scipy import ndimage

from quality_fragments import _components, _exterior, _rgba, _summary

VERSION = 'design-colour-regions/3'
PARAMETERS = {
    'transparentRgbPolicy': 'IGNORE; VISIBLE_NEAREST_EXTENSION_FOR_PALETTE_STATISTICS_ONLY',
    'exteriorMattePolicy': 'UNCONFIRMED_NEUTRAL_LIGHT_MATTE_HYPOTHESIS_NOT_OBSERVED_RGB',
    'exteriorMatteHypothesisRgb': [255, 255, 255],
    'histogramRgbBinWidth': 4,
    'paletteLabRadius': 5.0,
    'textureModeLabRadius': 12.0,
    'minimumCoherentModeFraction': 0.35,
    'minimumModeDensityFraction': 0.1,
    'minimumBoundaryContrastFraction': 0.5,
    'minimumCompetingCoreCoherence': 0.35,
    'coreNeighbourhoodRangeRgb': 20,
    'coreDistanceToAlphaBoundaryPx': 1.5,
    'minimumModeSupportPixels': 4,
    'maximumPaletteColors': 128,
    'localSupportRadiusPx': 4,
    'boundaryModelDistancePx': 2.5,
    'boundaryModelRgbResidual': 18.0,
    'boundaryResidualNorm': 'MAX_ABSOLUTE_CHANNEL',
    'boundaryMixMaximum': 1.05,
    'unsupportedBoundaryMaximumLabDistance': 24.0,
    'novelDetailLabDistance': 10.0,
    'isolatedDetailLabDistance': 25.0,
    'isolatedDetailSurroundSupportFraction': 0.9,
    'majorRelativeArea': 0.01,
    'majorMinimumAreaPx': 64,
    'islandMaximumAreaPx': 16,
    'islandMaximumExtentPx': 6,
    'islandMaximumAspectRatio': 2.0,
    'islandMaximumBodyDistancePx': 6.0,
    'islandMinimumBrightness': 160.0,
    'islandMaximumChromaRgb': 40.0,
    'islandPaletteProtectionLabDistance': 8.0,
}
CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], np.uint8)


def digest(array):
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def validate_request(palette=None, provenance=None):
    if palette is None:
        if provenance is not None:
            raise ValueError('automatic palette cannot claim reference provenance')
        return {'mode': 'AUTO', 'referencePalette': None, 'referenceProvenance': None}
    if (not isinstance(palette, list) or not 1 <= len(palette) <= PARAMETERS['maximumPaletteColors']
            or any(not isinstance(c, list) or len(c) != 3
                   or any(type(v) is not int or not 0 <= v <= 255 for v in c) for c in palette)):
        raise ValueError('reference palette must be a non-empty bounded list of exact RGB triples')
    if len({tuple(c) for c in palette}) != len(palette):
        raise ValueError('duplicate reference colour')
    if not isinstance(provenance, str) or not provenance.strip():
        raise ValueError('reference palette requires explicit provenance')
    return {'mode': 'REFERENCE', 'referencePalette': sorted([list(c) for c in palette]),
            'referenceProvenance': provenance}


def _lab(rgb):
    a = np.asarray(rgb, np.float32)
    return cv2.cvtColor(a.reshape(-1, 1, 3) / 255.0, cv2.COLOR_RGB2LAB).reshape(a.shape)


def _visible_neighbourhood_rgb(rgba):
    """Fill *statistical* neighborhoods from visible samples, never from alpha=0.

    A one-pixel colored line has no eroded core. Median filtering unobservable
    background RGB used to turn its palette seed black or white depending on
    PNG storage. Nearest extension leaves every visible sample untouched and
    cannot add foreground, join selections or alter the source image.
    """
    visible = rgba[..., 3] > 0
    rgb = rgba[..., :3].copy()
    if not visible.any():
        raise ValueError('design-colour proposal needs visible foreground')
    if not visible.all():
        nearest = ndimage.distance_transform_edt(~visible, return_distances=False, return_indices=True)
        rgb[~visible] = rgb[nearest[0][~visible], nearest[1][~visible]]
    return rgb


def _major(rgba):
    count, labels, stats, _ = _components(rgba[..., 3] > 0)
    largest = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
    major = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >=
             max(PARAMETERS['majorMinimumAreaPx'], largest * PARAMETERS['majorRelativeArea'])]
    if not major and count > 1:
        major = [1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())]
    return labels, stats, major


def _mode_palette(rgb, mask):
    """Deterministic weighted colour modes, variable count, no seeded answers."""
    values = rgb[mask]
    if not len(values):
        raise ValueError('no structural pixels available for design colours')
    width = PARAMETERS['histogramRgbBinWidth']
    bins, inverse, counts = np.unique(values // width, axis=0, return_inverse=True, return_counts=True)
    sums = np.column_stack([np.bincount(inverse, weights=values[:, c], minlength=len(bins)) for c in range(3)])
    means = sums / counts[:, None]
    labs = _lab(means)
    order = sorted(range(len(bins)), key=lambda i: (-int(counts[i]), tuple(int(v) for v in bins[i])))
    groups = []
    for i in order:
        candidates = [(float(np.linalg.norm(labs[i] - g['anchorLab'])), j) for j, g in enumerate(groups)]
        best = min(candidates) if candidates else (float('inf'), -1)
        if best[0] <= PARAMETERS['paletteLabRadius']:
            g = groups[best[1]]; g['sum'] += sums[i]; g['count'] += int(counts[i])
        else:
            groups.append({'anchorLab': labs[i], 'sum': sums[i].copy(), 'count': int(counts[i])})
    supported = [g for g in groups if g['count'] >= PARAMETERS['minimumModeSupportPixels']]
    if not supported:
        supported = [max(groups, key=lambda g: g['count'])]
    if len(supported) > PARAMETERS['maximumPaletteColors']:
        raise ValueError('automatic palette exceeds bounded capacity; no silent colour truncation')
    return sorted([{'rgb': np.rint(g['sum'] / g['count']).astype(int).tolist(),
                    'supportPixels': g['count'], 'evidence': 'SPATIALLY_STABLE_CORE_MODE'} for g in supported],
                  key=lambda g: tuple(g['rgb']))


def estimate_palette(rgba, config, request):
    _rgba(rgba)
    active = rgba[..., 3] >= config['structuralAlphaThreshold']
    if not active.any():
        raise ValueError('design-colour proposal needs structural foreground')
    if request['mode'] == 'REFERENCE':
        return [{'rgb': c, 'supportPixels': None, 'evidence': 'CALLER_REFERENCE'} for c in request['referencePalette']]
    labels, _, major = _major(rgba)
    bodies = np.isin(labels, major)
    rgb = _visible_neighbourhood_rgb(rgba)
    local_range = cv2.dilate(rgb, np.ones((3, 3), np.uint8)).astype(np.int16) - cv2.erode(rgb, np.ones((3, 3), np.uint8))
    depth = ndimage.distance_transform_edt(np.pad(active, 1))[1:-1, 1:-1]
    stable = active & (local_range.max(axis=2) <= PARAMETERS['coreNeighbourhoodRangeRgb'])
    core = stable & (depth >= PARAMETERS['coreDistanceToAlphaBoundaryPx'])
    seed = core & bodies
    if not seed.any():
        seed = active & bodies
    # Median samples stabilize palette estimation only. Neither the original
    # image nor the foreground geometry is filtered or resized.
    medians = cv2.medianBlur(rgb, 3)
    palette = _mode_palette(medians, seed)
    median_lab = _lab(medians)
    nearest_mode = np.stack([np.linalg.norm(median_lab-_lab(p['rgb']),axis=2) for p in palette]).argmin(axis=0)
    for index,item in enumerate(palette):
        support_mask = seed & (nearest_mode==index)
        _,_,parts,_ = _components(support_mask)
        item['largestCoherentCorePixels'] = int(parts[1:,cv2.CC_STAT_AREA].max()) if len(parts)>1 else 0
        item['assignedCorePixels'] = int(support_mask.sum())
        item['largestCoherentCoreFraction'] = item['largestCoherentCorePixels']/max(1,item['assignedCorePixels'])
    accepted=[]
    for item in sorted(palette,key=lambda p:(-p['assignedCorePixels'],tuple(p['rgb']))):
        nearest = min([(float(np.linalg.norm(_lab(item['rgb'])-_lab(p['rgb']))),i) for i,p in enumerate(accepted)],default=(float('inf'),-1))
        contrast=[]
        if nearest[1]>=0:
            own=nearest_mode==palette.index(item)
            parent=accepted[nearest[1]]
            merged=[palette.index(parent)]+[palette.index(child) for child in parent.get('absorbedTextureModes',[])]
            other=np.isin(nearest_mode,merged)
            for dy,dx in ((1,0),(0,1)):
                a=(slice(None,-1),slice(None)) if dy else (slice(None),slice(None,-1))
                b=(slice(1,None),slice(None)) if dy else (slice(None),slice(1,None))
                border=active[a]&active[b]&((own[a]&other[b])|(other[a]&own[b]))
                contrast.extend(np.linalg.norm(median_lab[a]-median_lab[b],axis=2)[border].tolist())
        item['sharedBoundaryMedianLabStep']=float(np.median(contrast)) if contrast else None
        gradual=bool(contrast) and item['sharedBoundaryMedianLabStep'] < nearest[0]*PARAMETERS['minimumBoundaryContrastFraction']
        blend_evidence=False
        if len(accepted)>1 and item['largestCoherentCoreFraction']<PARAMETERS['minimumCoherentModeFraction']:
            value=np.array(item['rgb'],float)
            for ai,first in enumerate(accepted):
                for second in accepted[ai+1:]:
                    start=np.array(first['rgb'],float);vector=np.array(second['rgb'],float)-start
                    fraction=float((value-start)@vector/max(float(vector@vector),1))
                    if 0<fraction<1 and np.linalg.norm(value-start-fraction*vector)<=18:
                        blend_evidence=True
        item['interiorMixtureEvidence']=blend_evidence
        propagated_texture=(gradual and nearest[0]<=2*PARAMETERS['textureModeLabRadius']
            and item['largestCoherentCoreFraction']<PARAMETERS['minimumCoherentModeFraction'])
        if blend_evidence or propagated_texture or (nearest[0] <= PARAMETERS['textureModeLabRadius']
                and (item['largestCoherentCoreFraction'] < PARAMETERS['minimumCoherentModeFraction']
                     or item['supportPixels'] < PARAMETERS['minimumModeDensityFraction']*item['assignedCorePixels']
                     or gradual)):
            accepted[nearest[1]].setdefault('absorbedTextureModes',[]).append(item)
        else:
            accepted.append(item)
    palette=accepted
    # Other disconnected motifs and very thin/small high-contrast details are
    # allowed to contribute colours. Exterior near-body neutral residue is not
    # evidence for a new material; it is handled separately, never hidden here.
    lab = _lab(rgb)
    nearest_color = np.min(np.stack([np.linalg.norm(lab - _lab(p['rgb']), axis=2) for p in palette]), axis=0)
    novel = active & (nearest_color > PARAMETERS['novelDetailLabDistance'])
    # A genuinely interior tiny design mark can be a single pixel. A boundary
    # transient cannot introduce a new colour based on distance alone.
    eligible = novel & core & ~bodies
    if eligible.any():
        extra = _mode_palette(rgb, eligible)
        for candidate in extra:
            if min(np.linalg.norm(_lab(candidate['rgb']) - _lab(p['rgb'])) for p in palette) > PARAMETERS['paletteLabRadius']:
                candidate['evidence'] = 'NOVEL_SPATIALLY_SUPPORTED_DETAIL'
                palette.append(candidate)
    # Preserve high-contrast marks too small to have an eroded core. They must
    # be interior, or separate chromatic/dark motifs, and not a mixture of
    # already supported colours. This is intentionally conservative.
    tiny_seed=active & (nearest_color>PARAMETERS['isolatedDetailLabDistance']) & ((depth>3)|(~bodies & ((np.ptp(rgb,axis=2)>40)|(rgb.mean(axis=2)<60))))
    n,cc,stats,_=_components(tiny_seed)
    for cid in range(1,n):
        mask=cc==cid
        ring=cv2.dilate(mask.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)&active&~mask
        # New tiny interior marks require a uniform supported surround. A
        # transition stripe along an existing colour boundary is not a mark.
        if ring.any() and max(float(np.mean(np.linalg.norm(lab[ring]-_lab(p['rgb']),axis=1)<=10)) for p in palette)<PARAMETERS['isolatedDetailSurroundSupportFraction']:
            continue
        value=np.median(rgb[mask],axis=0)
        if min(np.linalg.norm(_lab(value)-_lab(p['rgb'])) for p in palette)<=PARAMETERS['paletteLabRadius']:
            continue
        mixture=False
        for ai,first in enumerate(palette):
            for second in palette[ai+1:]:
                start=np.array(first['rgb'],float);v=np.array(second['rgb'],float)-start
                t=float((value-start)@v/max(float(v@v),1))
                if 0<t<1 and np.linalg.norm(value-start-t*v)<=18: mixture=True
        if not mixture:
            palette.append({'rgb':np.rint(value).astype(int).tolist(),'supportPixels':int(stats[cid,4]),'evidence':'PROTECTED_HIGH_CONTRAST_DETAIL'})
    if len(palette) > PARAMETERS['maximumPaletteColors']:
        raise ValueError('automatic palette exceeds bounded capacity')
    return sorted(palette, key=lambda p: tuple(p['rgb']))


def cleanup_foreground(rgba, config, request, *, enabled):
    """Propose unsupported exterior blend residue, not area-only deletion."""
    _rgba(rgba)
    p = PARAMETERS
    palette = estimate_palette(rgba, config, request)
    labels, stats, majors = _major(rgba)
    body = np.isin(labels, majors)
    distance, near = ndimage.distance_transform_edt(~body, return_indices=True)
    exterior = _exterior(rgba[..., 3] > 0)
    derived = rgba.copy(); records = []
    for cid in range(1, len(stats)):
        mask = labels == cid
        x, y, w, h, area = [int(v) for v in stats[cid]]
        rgb = np.median(rgba[mask, :3], axis=0)
        ring = cv2.dilate(mask.astype(np.uint8), CROSS).astype(bool) & exterior
        # Alpha-zero RGB is not evidence of a physical background/matte. Keep
        # the existing conservative light-residue *hypothesis* explicit; no
        # source samples, including hidden PNG RGB, confirm this assumption.
        outside = np.asarray(p['exteriorMatteHypothesisRgb'], dtype=float)
        points = np.argwhere(mask); pos = points[np.argmin(distance[mask])]
        near_rgb = rgba[near[0, pos[0], pos[1]], near[1, pos[0], pos[1]], :3].astype(float)
        # Use the inferred design colour nearest the adjacent body's actual
        # sample, not a hard-coded black/white pair.
        # The nearest pixel can itself be an antialiasing mixture. Test only
        # locally supported palette colours, not its unreliable nearest colour.
        yy,xx=int(pos[0]),int(pos[1]); radius=8
        local=rgba[max(0,yy-radius):yy+radius+1,max(0,xx-radius):xx+radius+1]
        local_body=body[max(0,yy-radius):yy+radius+1,max(0,xx-radius):xx+radius+1]
        fits=[]
        for item in palette:
            base=np.array(item['rgb'],float)
            if not np.any(local_body & (np.linalg.norm(_lab(local[...,:3])-_lab(base),axis=2)<=10)):
                continue
            direction=outside-base; denominator=float(direction@direction)
            mix=float((rgb-base)@direction/denominator) if denominator else -1.0
            residual=float(np.linalg.norm(rgb-(base+np.clip(mix,0,1)*direction)))
            fits.append((residual,tuple(base),mix))
        residual,base,mix=min(fits,default=(999.0,tuple(near_rgb),-1.0));base=np.array(base)
        palette_distance = float(min(np.linalg.norm(_lab(rgb)-_lab(v['rgb'])) for v in palette))
        reasons = []
        if cid in majors: reasons.append('MAJOR_BODY')
        if area > p['islandMaximumAreaPx']: reasons.append('AREA_OUTSIDE_RESIDUE_MODEL')
        if max(w,h) > p['islandMaximumExtentPx'] or max(w,h)/min(w,h) > p['islandMaximumAspectRatio']: reasons.append('EXTENDED_DETAIL')
        if float(distance[mask].min()) > p['islandMaximumBodyDistancePx']: reasons.append('NOT_NEAR_BODY')
        if float(rgb.mean()) < p['islandMinimumBrightness'] or float(np.ptp(rgb)) > p['islandMaximumChromaRgb']: reasons.append('DARK_OR_CHROMATIC_DETAIL')
        if palette_distance <= p['islandPaletteProtectionLabDistance']: reasons.append('SUPPORTED_DESIGN_COLOR')
        if not ring.any() or not 0.1 <= mix <= 1.0 or residual > p['boundaryModelRgbResidual']: reasons.append('NO_EXTERIOR_BLEND_EVIDENCE')
        if np.any(ndimage.binary_fill_holes(mask, structure=CROSS) & ~mask): reasons.append('HOLE_PROTECTED')
        remove = enabled and not reasons
        if remove: derived[mask,3] = 0
        records.append({'inputIslandId':cid, 'bbox':[x,y,w,h], 'areaPx':area, 'medianRgb':rgb.tolist(),
                        'nearestMajorDistancePx':float(distance[mask].min()), 'adjacentBodyDesignRgb':base.tolist(),
                        'exteriorMatteHypothesisRgb':outside.tolist(),
                        'matteEvidence':'ASSUMED_NOT_OBSERVED_OR_CONFIRMED',
                        'blendFraction':mix, 'blendResidualRgb':residual,
                        'paletteLabDistance':palette_distance, 'reasons':reasons or ['UNSUPPORTED_COMPACT_EXTERIOR_BLEND'],
                        'action':'REMOVED_IN_DERIVED_CANDIDATE' if remove else 'PRESERVED',
                        'proposal':'KEEP' if reasons else 'REMOVE_UNCONFIRMED',
                        'changedPixelsXY':points[:,::-1].tolist() if remove else []})
    changed = np.argwhere(derived[...,3] != rgba[...,3])
    return derived, {'strategyVersion':VERSION+'/cleanup','effectiveParameters':copy.deepcopy(p),'enabled':enabled,
                     'paletteEvidence':palette,'request':request,'records':records,'manualConfirmation':'NOT_CONFIRMED',
                     'sourceModified':False,'removedIslandCount':sum(x['action']=='REMOVED_IN_DERIVED_CANDIDATE' for x in records),
                     'changedAlphaPixelCount':len(changed),'changedPixelsXY':changed[:,::-1].tolist(),
                     'originalRgbaSha256':digest(rgba),'derivedRgbaSha256':digest(derived)}


def rebuild_regions(rgba, old_labels, old_pixels, config, request):
    from color_purification import assign_fringe_pixels
    _rgba(rgba)
    if old_labels.dtype != np.int32 or old_labels.shape != rgba.shape[:2]:
        raise ValueError('old labels must be int32 and match full input resolution')
    active = rgba[...,3] >= config['structuralAlphaThreshold']
    if not np.array_equal(old_labels>0,active): raise ValueError('old label coverage mismatch')
    expected,_ = assign_fringe_pixels(rgba,old_labels,config)
    if not np.array_equal(expected,old_pixels): raise ValueError('old fringe mismatch')
    palette = estimate_palette(rgba,config,request)
    rgb = rgba[...,:3]; lab = _lab(rgb)
    distances = np.stack([np.linalg.norm(lab-_lab(p['rgb']),axis=2) for p in palette])
    chosen = distances.argmin(axis=0).astype(np.int32)
    # A local exterior compositing model separates transition pixels from
    # actual design colours. Interior colours cannot be merged by this rule.
    foreground = rgba[...,3]>0
    depth = ndimage.distance_transform_edt(foreground)
    # A bounded, unconfirmed neutral-light mixing hypothesis, not a sample of
    # invisible RGB. Exact inks and locally supported details remain protected.
    outside_rgb = np.broadcast_to(np.asarray(PARAMETERS['exteriorMatteHypothesisRgb'],
                                             dtype=np.float32), rgb.shape)
    edge = active & (depth <= PARAMETERS['boundaryModelDistancePx']) & bool((~foreground).any())
    radius = PARAMETERS['localSupportRadiusPx']; size = 2*radius+1
    best = np.full(active.shape,np.inf); mixed = chosen.copy(); local_support=[]
    exact_detail=np.min(distances,axis=0)<=PARAMETERS['paletteLabRadius']
    for index,p in enumerate(palette):
        base = np.array(p['rgb'],np.float32); direction = outside_rgb-base
        denominator = np.sum(direction*direction,axis=2)
        fraction = np.sum((rgb.astype(np.float32)-base)*direction,axis=2)/np.maximum(denominator,1)
        residual = np.max(np.abs(rgb-(base+np.clip(fraction,0,1)[...,None]*direction)),axis=2)
        # Exterior mixtures cannot establish support for another design colour:
        # otherwise a bright transition self-seeds false islands in that colour.
        # Exact palette-colour edge details remain protected below.
        seed = active & (depth>PARAMETERS['boundaryModelDistancePx']) & (chosen==index) & (distances[index]<=PARAMETERS['paletteLabRadius']*2)
        support = cv2.boxFilter(seed.astype(np.float32),-1,(size,size),normalize=False,borderType=cv2.BORDER_CONSTANT)
        local_support.append(support>0)
        allowed = edge & ~exact_detail & (support>0) & (fraction>=0) & (fraction<=PARAMETERS['boundaryMixMaximum']) & (residual<=PARAMETERS['boundaryModelRgbResidual'])
        score = residual + 1/(1+support)
        take = allowed & (score<best)
        mixed[take]=index; best[take]=score[take]
    chosen[edge & np.isfinite(best)] = mixed[edge & np.isfinite(best)]
    # Dark ringing need not fit a positive foreground/exterior mixture. A
    # non-exact edge sample still cannot invent a locally unsupported colour
    # when a compatible interior design core is present. This is spatially
    # gated, bounded in colour distance and never applied to exact tiny marks.
    supported=np.stack(local_support)
    current_supported=np.take_along_axis(supported,chosen[None,...],axis=0)[0]
    supported_distances=np.where(supported,distances,np.inf)
    supported_choice=supported_distances.argmin(axis=0)
    boundary_reowned=edge & ~exact_detail & ~current_supported & (supported_distances.min(axis=0)<=PARAMETERS['unsupportedBoundaryMaximumLabDistance'])
    chosen[boundary_reowned]=supported_choice[boundary_reowned]
    # CP-B is a provisional spatial support, not immutable colour truth. A
    # coherent competing design core may split it; weak texture/edge samples
    # instead use its robust colour estimate. Exact palette details survive,
    # even a single pixel. No foreground support is added or removed here.
    reownership=[]
    for rid in np.unique(old_labels[old_labels>0]):
        count,cc,stats,_=_components(old_labels==rid)
        for cid in range(1,count):
            mask=cc==cid
            median=np.median(rgb[mask],axis=0)
            owner=int(np.argmin([np.linalg.norm(_lab(median)-_lab(p['rgb'])) for p in palette]))
            if np.linalg.norm(_lab(median)-_lab(palette[owner]['rgb']))>10:
                continue
            weak=np.zeros(mask.shape,bool)
            for alternate in np.unique(chosen[mask]):
                if alternate==owner: continue
                competing=mask & (chosen==alternate) & (distances[alternate]<=PARAMETERS['paletteLabRadius'])
                if competing.any():
                    _,_,parts,_=_components(competing)
                    coherence=int(parts[1:,4].max())/int(competing.sum())
                    if coherence<PARAMETERS['minimumCompetingCoreCoherence']:
                        weak |= mask & (chosen==alternate)
                else:
                    weak |= mask & (chosen==alternate)
            # Repeated disconnected design marks can each have a low fraction
            # of the total competing support. Old-region majority is not
            # permission to erase an actual match to an already inferred ink.
            different=weak & (chosen!=owner) & ~exact_detail
            if different.any():
                reownership.append({'oldRegionId':int(rid),'oldComponentIndex':cid,
                    'newDesignLabel':owner+1,'pixels':int(different.sum()),
                    'reason':'ROBUST_SPATIAL_SUPPORT_FOR_SAMPLES_WITHOUT_DESIGN_CORE_MATCH'})
                chosen[different]=owner
    # Reconcile unsupported colour islands in the connected exterior
    # uncertainty band. A fixed per-pixel edge cutoff can leave isolated
    # assignments just behind that cutoff, which become real holes and seams.
    # This is NOT small-region deletion: there is no area threshold, and every
    # pixel must lack an ink match, be connected to the exterior through other
    # uncertain samples, have one surrounding design owner, and have that
    # owner's local core support without support for its current identity.
    # Exact tiny marks, coherent competing inks, interior details and true
    # alpha holes cannot satisfy these conditions.
    uncertain = active & ~exact_detail & (depth <= radius)
    exterior = _exterior(foreground)
    entrance = uncertain & cv2.dilate(exterior.astype(np.uint8), CROSS).astype(bool)
    transition_band = ndimage.binary_propagation(entrance, structure=CROSS, mask=uncertain)
    reconciled = chosen.copy()
    transition_records = []
    for index in range(len(palette)):
        count, components, stats, _ = _components(active & (chosen == index))
        for cid in range(1, count):
            mask = components == cid
            if not np.all(transition_band[mask]) or np.any(supported[index][mask]):
                continue
            ring = cv2.dilate(mask.astype(np.uint8), CROSS).astype(bool) & active & ~mask
            neighbors = np.unique(chosen[ring])
            if len(neighbors) != 1 or neighbors[0] == index:
                continue
            owner = int(neighbors[0])
            if not np.all(supported[owner][mask]):
                continue
            reconciled[mask] = owner
            transition_records.append({
                'fromDesignLabel': index+1, 'toDesignLabel': owner+1,
                'bbox': [int(v) for v in stats[cid,:4]], 'pixels': int(mask.sum()),
                'changedPixelsXY': np.argwhere(mask)[:,::-1].tolist(),
                'reason': 'EXTERIOR_CONNECTED_UNCERTAINTY_WITH_SINGLE_SUPPORTED_SURROUND',
                'ownCoreSupport': False, 'exactInkMatch': False,
                'alphaChanged': False, 'manualConfirmation': 'NOT_CONFIRMED',
            })
    chosen = reconciled
    labels = np.where(active,chosen+1,0).astype(np.int32)
    # Same design identity reuses one label. Region Core derives each actual
    # 4-connected Component separately; no dilation, bridge or same-colour union
    # across absent foreground is performed.
    pixels,fringe = assign_fringe_pixels(rgba,labels,config)
    mappings=[]
    for rid in np.unique(old_labels[old_labels>0]):
        count,cc,stats,_ = _components(old_labels==rid)
        for cid in range(1,count):
            mask=cc==cid; values,counts=np.unique(labels[mask],return_counts=True)
            mappings.append({'oldRegionId':int(rid),'oldComponentIndex':cid,'bbox':[int(v) for v in stats[cid,:4]],
                             'areaPx':int(stats[cid,4]),'newLabels':[{'regionId':int(v),'pixels':int(n)} for v,n in zip(values,counts)],
                             'reason':'GLOBAL_DESIGN_IDENTITY_REASSIGNED_THEN_SPATIAL_COMPONENTS_REBUILT'})
    # Label numbers themselves have no old/new identity correspondence.
    changed=np.argwhere(labels!=old_labels)
    return labels,pixels,{'strategyVersion':VERSION,'request':request,'effectiveParameters':copy.deepcopy(PARAMETERS),
                          'paletteProposal':palette,'automaticUsesReferenceAnswer':False,
                          'paletteColorCount':len(palette),'actualUsedColorCount':len(np.unique(labels[labels>0])),
                          'spatialReownership':reownership,
                          'exteriorTransitionReownership':transition_records,
                          'exteriorTransitionReownedPixelCount':sum(r['pixels'] for r in transition_records),
                          'before':_summary(old_labels),'after':_summary(labels),'componentMappings':mappings,
                          'labelDifferencePixelCount':len(changed),
                          'changedPixelsXYSample':changed[::max(1,(len(changed)+2047)//2048),::-1].tolist(),
                          'completeChangeMap':'derived by comparing persisted old and new full-resolution structural label maps',
                          'labelDifferenceMeaning':'New global identity numbering; not a colour-error metric',
                          'exteriorModelPixelCount':int(np.count_nonzero(edge & np.isfinite(best))),
                          'unsupportedBoundaryReownedPixelCount':int(np.count_nonzero(boundary_reowned)),
                          'outputStructuralSha256':digest(labels),'outputPixelSha256':digest(pixels),
                          'sourceAlphaModified':False,'fringeAssignment':fringe,'manualQualityStatus':'PENDING_MANUAL_REVIEW',
                          'representativeColorPolicy':'RC-A_RECOMPUTED_GLOBALLY_PER_NEW_DESIGN_COLOR_IDENTITY'}
