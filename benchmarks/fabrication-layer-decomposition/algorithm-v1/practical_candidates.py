"""Bounded source-supported keep/merge hypotheses for the opt-in selector.

All decisions use visible samples and actual adjacency. Numeric palette labels
are identities, never confidence; no case, location or expected answer enters.
"""
from __future__ import annotations

import copy
import numpy as np
from scipy import ndimage
from skimage.segmentation import watershed

from design_color_regions import CROSS, _lab, digest
from quality_fragments import _components

VERSION = 'local-ownership-candidates/2'
PARAMETERS = {
    'maximumFeedbackRounds': 2,
    'maximumHypothesesPerDomain': 2,
    'boundarySamplingRadiiPx': [1, 2, 4],
    'minimumBoundaryContrastLab': 2.5,
    'boundaryPaletteContrastFraction': 0.40,
    'supportedBoundaryFraction': 0.50,
    'minimumTextureInterfaceSamples': 8,
    'textureMaximumPaletteSeparationLab': 12.0,
    'textureMaximumFineStepFraction': 0.25,
    'textureMaximumWideStepFraction': 0.50,
    'minimumResolvedWidthPx': 2.0,
    'minimumLocalPlateauSupport': 0.65,
    'maximumLocalColorResidualLab': 8.0,
    'pointMixtureMaximumRgbResidual': 4.0,
    'pointMixtureMinimumFraction': 0.08,
    'minimumInteriorRescueFraction': 0.5,
    'minimumInteriorRescueDepthPx': 4.0,
    'transitionMixtureMaximumRgbResidual': 6.0,
    'additionalBoundaryCostLabPx': 3.0,
    'maximumMissingInkProposals': 8,
    'missingInkMinimumResidualLab': 10.0,
    'missingInkMaximumDispersionLab': 3.0,
    'missingInkMinimumSurroundFraction': 0.85,
    'missingInkMinimumBoundaryFraction': 0.8,
    'missingInkSpatialSupport': 'CONTINUOUS_THREE_SAMPLE_STROKE_OR_2X2_PATCH',
}


def propose_missing_inks(rgb, active, palette):
    """Recover a coherent mark omitted by palette erosion, not every outlier.

    The actual component must be internally stable, interior to foreground and
    sharply bounded by one supported face. No erosion core is demanded from
    the mark itself. A transition between faces does not have that surround.
    This is AUTO-only; reference palettes are never silently augmented.
    """
    lab = _lab(rgb)
    labs = _lab(np.asarray([p['rgb'] for p in palette], np.float32))
    distances = np.stack([np.linalg.norm(lab-c, axis=2) for c in labs])
    nearest = distances.argmin(0)
    depth = ndimage.distance_transform_edt(np.pad(active, 1))[1:-1, 1:-1]
    missing = active & (distances.min(0) > PARAMETERS['missingInkMinimumResidualLab'])
    count, components, stats, _ = _components(missing)
    candidates = []
    for cid in range(1, count):
        x,y,w,h,area = map(int, stats[cid])
        section = np.s_[max(0,y-1):min(active.shape[0],y+h+1),max(0,x-1):min(active.shape[1],x+w+1)]
        part = components[section] == cid
        if float(np.min(depth[section][part])) < 4: continue
        samples = lab[section][part]
        median = np.median(samples, axis=0)
        if float(np.mean(np.linalg.norm(samples-median,axis=1) <= PARAMETERS['missingInkMaximumDispersionLab'])) < 0.9: continue
        consistent=part & (np.linalg.norm(lab[section]-median,axis=2)<=PARAMETERS['missingInkMaximumDispersionLab'])
        # A lone matching sample is not evidence of a missing palette ink.
        # Require continuity or a resolved patch, not a large erosion core.
        # Existing one-pixel authored details remain under the original
        # high-contrast/detail rule; this extra rescue never deletes them.
        spatial=any(ndimage.binary_erosion(consistent,structure=np.ones(shape,bool)).any()
                    for shape in ((1,3),(3,1),(2,2)))
        if not spatial: continue
        ring = ndimage.binary_dilation(part,CROSS) & active[section] & ~part
        if not ring.any(): continue
        counts = np.bincount(nearest[section][ring],minlength=len(labs))
        surround = int(counts.argmax())
        if counts[surround]/ring.sum() < PARAMETERS['missingInkMinimumSurroundFraction']: continue
        contrast = float(np.linalg.norm(median-labs[surround]))
        steps=[]
        for axis in (0,1):
            a=(slice(None,-1),slice(None)) if axis==0 else (slice(None),slice(None,-1))
            b=(slice(1,None),slice(None)) if axis==0 else (slice(None),slice(1,None))
            for aa,bb in ((a,b),(b,a)):
                border=part[aa]&ring[bb]
                steps.extend(np.linalg.norm(lab[section][aa]-lab[section][bb],axis=2)[border].tolist())
        fraction=float(np.mean(np.array(steps)>=max(5.0,0.6*contrast))) if steps else 0.0
        if fraction < PARAMETERS['missingInkMinimumBoundaryFraction']: continue
        value=np.rint(np.median(rgb[section][part],axis=0)).astype(int).tolist()
        candidates.append({'rgb':value,'supportPixels':area,'boundarySupportFraction':fraction,
                           'evidence':'UNIFORM_SURROUND_SHARP_INTERIOR_MARK','bbox':[x,y,w,h]})
    proposals=[]
    result=copy.deepcopy(palette)
    for item in sorted(candidates,key=lambda r:(-r['boundarySupportFraction'],-r['supportPixels'],tuple(r['rgb']))):
        if min(float(np.linalg.norm(_lab(item['rgb'])-_lab(p['rgb']))) for p in result) <= PARAMETERS['missingInkMinimumResidualLab']: continue
        added=len(proposals)<PARAMETERS['maximumMissingInkProposals'] and len(result)<128
        proposals.append({**item,'selected':'ADD_SUPPORTED_INK' if added else 'AMBIGUOUS_CAPACITY_LIMIT'})
        if added: result.append(item)
    return sorted(result,key=lambda r:tuple(r['rgb'])),proposals


def boundary_pairs(lab, labels, active, radius):
    """Sample both sides of an actual interface without crossing a third ink.

    Sampling validity is recorded implicitly by the pair label checks. The
    second/third sample detects antialias ramps without blurring final labels.
    """
    pairs = []
    for axis in (0, 1):
        a = (slice(None, -1), slice(None)) if axis == 0 else (slice(None), slice(None, -1))
        b = (slice(1, None), slice(None)) if axis == 0 else (slice(None), slice(1, None))
        yy, xx = np.where(active[a] & active[b] & (labels[a] != labels[b]))
        ay, ax = yy.copy(), xx.copy()
        by, bx = yy.copy(), xx.copy()
        if axis == 0:
            ay -= radius-1; by += radius
        else:
            ax -= radius-1; bx += radius
        ok = (ay >= 0) & (ax >= 0) & (by < active.shape[0]) & (bx < active.shape[1])
        yy,xx,ay,ax,by,bx = [v[ok] for v in (yy,xx,ay,ax,by,bx)]
        left, right = labels[a][yy,xx], labels[b][yy,xx]
        ok = active[ay,ax] & active[by,bx] & (labels[ay,ax] == left) & (labels[by,bx] == right)
        # Matching endpoints alone can jump a third ink or a transparent hole.
        for offset in range(radius):
            ly,lx=(yy-offset,xx) if axis==0 else (yy,xx-offset)
            ry,rx=(yy+1+offset,xx) if axis==0 else (yy,xx+1+offset)
            ok &= active[ly,lx] & active[ry,rx] & (labels[ly,lx]==left) & (labels[ry,rx]==right)
        pairs.append((yy[ok],xx[ok],axis,left[ok],right[ok],
                      np.linalg.norm(lab[ay[ok],ax[ok]]-lab[by[ok],bx[ok]],axis=1)))
    return pairs


def compare_ownership(rgb, active, colors, nearest, markers, gradient):
    lab = _lab(rgb)
    foreground_depth=ndimage.distance_transform_edt(np.pad(active,1))[1:-1,1:-1]
    color_labs = _lab(colors)
    interface = {}
    for radius in PARAMETERS['boundarySamplingRadiiPx']:
        for _,_,_,left,right,steps in boundary_pairs(lab,nearest,active,radius):
            for pair in np.unique(np.sort(np.column_stack((left,right)),axis=1),axis=0):
                first,second = map(int,pair)
                selected = ((left==first)&(right==second))|((left==second)&(right==first))
                interface.setdefault((first,second),{}).setdefault(radius,[]).extend(steps[selected].tolist())
    parent = list(range(len(colors)))
    support = np.bincount(nearest[active],minlength=len(colors))
    def root(i):
        while parent[i] != i: i=parent[i]
        return i
    def diffuse(first,second):
        samples=interface.get(tuple(sorted((first,second))))
        separation=float(np.linalg.norm(color_labs[first]-color_labs[second]))
        if separation>PARAMETERS['textureMaximumPaletteSeparationLab']: return False
        if samples is None: return True  # No interface claim; the cluster span is still bounded.
        wide=samples.get(4,[])
        return (len(wide)>=PARAMETERS['minimumTextureInterfaceSamples']
                and float(np.median(samples[1]))<separation*PARAMETERS['textureMaximumFineStepFraction']
                and float(np.median(wide))<separation*PARAMETERS['textureMaximumWideStepFraction'])
    palette_decisions=[]
    # Only direct adjacent diffuse interfaces qualify. Never connect separated
    # shapes or infer an identity merge from colour distance alone.
    for (first,second),samples in sorted(interface.items(),key=lambda item:
            tuple(sorted(tuple(colors[i]) for i in item[0]))):
        separation=float(np.linalg.norm(color_labs[first]-color_labs[second]))
        fine=float(np.median(samples[1]))
        wide=float(np.median(samples.get(4,[]))) if samples.get(4) else None
        merge=(wide is not None and len(samples.get(4,[])) >= PARAMETERS['minimumTextureInterfaceSamples']
               and separation <= PARAMETERS['textureMaximumPaletteSeparationLab']
               and fine < separation*PARAMETERS['textureMaximumFineStepFraction']
               and wide < separation*PARAMETERS['textureMaximumWideStepFraction'])
        if merge:
            aa,bb=root(first),root(second)
            members_a=[i for i in range(len(colors)) if root(i)==aa]
            members_b=[i for i in range(len(colors)) if root(i)==bb]
            # A-B/B-C diffuse interfaces must not erase a sharp A-C boundary,
            # nor chain an unbounded palette excursion through many near inks.
            merge=all(diffuse(a,b) for a in members_a for b in members_b if a!=b)
        if merge:
            keep,drop=sorted((aa,bb),key=lambda i:(-int(support[i]),tuple(colors[i])))
            parent[drop]=keep
        palette_decisions.append({'designLabels':[first+1,second+1], 'paletteStepLab':separation,
            'fineBoundaryStepLab':fine,'wideBoundaryStepLab':wide,
            'wideBoundarySamples':len(samples.get(4,[])),
            'selected':'MERGE_DIFFUSE_INTERFACE' if merge else 'RETAIN_DISTINCT_HYPOTHESES'})
    mapping=np.array([root(i) for i in range(len(colors))],np.int32)
    chosen=mapping[nearest]
    resolved_ink_cores={}
    for index in np.unique(chosen[active]):
        own=active&(chosen==index)
        own_depth=ndimage.distance_transform_edt(np.pad(own,1))[1:-1,1:-1]
        resolved_ink_cores[int(index)]=own&(own_depth>=3.5)
    adjusted=markers.copy()
    seeded=adjusted>0
    adjusted[seeded]=mapping[adjusted[seeded]-1]+1
    # Multiscale spatial support is computed on fused domains, so a weak
    # competing texture mode cannot erase an otherwise bounded pale panel.
    probes={r:boundary_pairs(lab,chosen,active,r) for r in PARAMETERS['boundarySamplingRadiiPx']}
    hypotheses=[]
    lost_masks=[]
    for index in np.unique(chosen[active]):
        count,comps,stats,_=_components(active & (chosen==index))
        for cid in range(1,count):
            x,y,w,h,area=map(int,stats[cid])
            section=np.s_[max(0,y-1):min(active.shape[0],y+h+1),max(0,x-1):min(active.shape[1],x+w+1)]
            part=comps[section]==cid
            depth=ndimage.distance_transform_edt(np.pad(part,1))[1:-1,1:-1]
            maximum=float(depth.max())
            core=part & (depth >= min(3.5,max(1.0,maximum/2)))
            median=np.median(lab[section][core],axis=0)
            residuals=np.linalg.norm(lab[section][core]-median,axis=1)
            stable=float(np.mean(residuals <= PARAMETERS['maximumLocalColorResidualLab']))
            steps_by_radius={}
            fractions={}
            for radius,pairs in probes.items():
                values=[]; thresholds=[]
                for yy,xx,axis,left,right,steps in pairs:
                    by,bx=(yy+1,xx) if axis==0 else (yy,xx+1)
                    selected=(comps[yy,xx]==cid)|(comps[by,bx]==cid)
                    values.extend(steps[selected].tolist())
                    thresholds.extend(np.maximum(PARAMETERS['minimumBoundaryContrastLab'],
                        np.linalg.norm(color_labs[left[selected]]-color_labs[right[selected]],axis=1)*
                        PARAMETERS['boundaryPaletteContrastFraction']).tolist())
                steps_by_radius[str(radius)]=float(np.median(values)) if values else None
                fractions[str(radius)]=float(np.mean(np.array(values)>=np.array(thresholds))) if values else 0.0
            resolved=maximum>=PARAMETERS['minimumResolvedWidthPx']
            supported=stable>=PARAMETERS['minimumLocalPlateauSupport']
            continuity=fractions['4']
            palette_residual=float(np.linalg.norm(median-color_labs[index]))
            preserve=(resolved and supported and continuity>=PARAMETERS['supportedBoundaryFraction']
                      and palette_residual<=PARAMETERS['maximumLocalColorResidualLab'])
            # Thin features use the original source-colour plus continuous
            # step test; boundary contrast alone also fires on antialias rims.
            original_seed=bool(np.any(adjusted[section][part]==index+1))
            ring=ndimage.binary_dilation(part,CROSS)&active[section]&~part
            # Compare local description loss with an explicit boundary burden.
            # A compact high-contrast detail can win without a large core;
            # a long uncertain edge strip pays for its actual perimeter.
            broad=np.s_[max(0,y-8):min(active.shape[0],y+h+8),max(0,x-8):min(active.shape[1],x+w+8)]
            neighbour_colors=[]
            for n in np.unique(chosen[section][ring]):
                valid=resolved_ink_cores[int(n)][broad]
                if valid.any(): neighbour_colors.append(np.median(lab[broad][valid],axis=0))
            if not neighbour_colors and ring.any(): neighbour_colors=[np.median(lab[section][ring],axis=0)]
            raw=lab[section][core]
            own_error=np.linalg.norm(raw-color_labs[index],axis=1)
            merge_error=(np.min(np.stack([np.linalg.norm(raw-c,axis=1) for c in neighbour_colors]),axis=0)
                         if neighbour_colors else own_error)
            improvement=float(np.mean(merge_error-own_error))
            padded=np.pad(part,1).astype(np.int8)
            perimeter=int(np.abs(np.diff(padded,axis=0)).sum()+np.abs(np.diff(padded,axis=1)).sum())
            keep_cost=float(PARAMETERS['additionalBoundaryCostLabPx']*perimeter)
            merge_cost=improvement*area
            evidence_wins=merge_cost>keep_cost
            preserve=preserve and evidence_wins
            interior_fraction=float(np.mean(foreground_depth[section][part]>=PARAMETERS['minimumInteriorRescueDepthPx']))
            unresolved_exterior=(maximum<3.5 and interior_fraction<PARAMETERS['minimumInteriorRescueFraction'])
            transition=False
            # A thin third-ink hypothesis situated between two resolved local
            # faces needs to defeat their mixing explanation before promotion.
            # Its actual width/adjacency and RGB fit matter together.
            if maximum<3.5:
                broad=np.s_[max(0,y-6):min(active.shape[0],y+h+6),max(0,x-6):min(active.shape[1],x+w+6)]
                neighbours=[int(i) for i in np.unique(chosen[section][ring]) if i!=index]
                inks=[]
                for n in neighbours:
                    valid=resolved_ink_cores[n][broad]
                    if valid.any(): inks.append(np.median(rgb[broad][valid],axis=0))
                samples=rgb[section][core].astype(float)
                for ai,aa in enumerate(inks):
                    for bb in inks[ai+1:]:
                        vector=bb-aa; norm=float(vector@vector)
                        if norm<64: continue
                        weights=(samples-aa)@vector/norm
                        error=np.abs(samples-aa-weights[:,None]*vector).max(axis=1)
                        good=(error<=PARAMETERS['transitionMixtureMaximumRgbResidual'])&(weights>0.03)&(weights<0.97)
                        if float(np.mean(good))>=0.8: transition=True
            preserve=preserve and not transition and not unresolved_exterior
            mixture=False
            if max(w,h)<=2 and ring.sum()>=2:
                observations=rgb[section][ring].astype(float)
                span=np.sum((observations[:,None]-observations[None,:])**2,axis=2)
                ai,bi=np.unravel_index(span.argmax(),span.shape)
                aa,bb=observations[ai],observations[bi]
                vector=bb-aa
                norm=float(vector@vector)
                if norm>=64:
                    samples=rgb[section][part].astype(float)
                    weights=(samples-aa)@vector/norm
                    error=np.abs(samples-aa-weights[:,None]*vector).max(axis=1)
                    low=PARAMETERS['pointMixtureMinimumFraction']
                    mixture=bool(np.all(error<=PARAMETERS['pointMixtureMaximumRgbResidual'])
                                 and np.all((weights>=low)&(weights<=1-low)))
            if mixture or transition:
                adjusted[section][part]=0
                original_seed=False
                preserve=False
            selected=preserve or original_seed
            if preserve:
                seed_mask=core
                lost_masks.append((section,seed_mask.copy(),int(index+1)))
            hypotheses.append({'designLabel':int(index+1),'bbox':[x,y,w,h],'pixels':area,
                'localPlateauFraction':stable,'maximumHalfWidthPx':maximum,
                'boundaryStepsLab':steps_by_radius,'supportedBoundaryFractions':fractions,
                'baselineSeed':original_seed,'keepEvidence':bool(preserve),
                'localPaletteResidualLab':palette_residual,'localPointMixtureEvidence':mixture,
                'comparisonCosts':{'keepBoundaryCost':keep_cost,'mergeSourceLoss':merge_cost,'sourceLossPerPixel':improvement},
                'twoResolvedAdjacentFaceMixture':transition,'unresolvedExteriorBand':unresolved_exterior,
                'alternatives':['KEEP_OBSERVED_DOMAIN','MERGE_TO_ADJACENT_SUPPORTED_DOMAIN'],
                'selected':'KEEP' if selected else 'SPATIAL_COMPARISON',
                'ambiguity':'NONE' if preserve else 'LOCAL_EVIDENCE_INSUFFICIENT' if not original_seed else 'BASELINE_SUPPORT_ONLY'})
    initial=watershed(gradient,markers,connectivity=CROSS,mask=active).astype(np.int32)
    result=watershed(gradient,adjusted,connectivity=CROSS,mask=active).astype(np.int32)
    feedback=[]
    for round_index in range(PARAMETERS['maximumFeedbackRounds']):
        rescued=0
        for section,core,label in lost_masks:
            missing=core & (result[section]!=label)
            if missing.any():
                adjusted[section][missing]=label
                rescued+=int(missing.sum())
        feedback.append({'round':round_index+1,'missingSupportedCorePixels':rescued})
        if not rescued: break
        result=watershed(gradient,adjusted,connectivity=CROSS,mask=active).astype(np.int32)
    return result,adjusted,{'version':VERSION,'parameters':copy.deepcopy(PARAMETERS),
        'paletteComparisons':palette_decisions,'domainComparisons':hypotheses,'structureLossFeedback':feedback,
        'baselineCandidateSha256':digest(initial),'selectedCandidateSha256':digest(result),
        'changedFromBaselinePixels':int(np.count_nonzero(initial!=result)),
        'confidenceUsesMarkerOrdinal':False,'qualityProxyIsHumanTruth':False}
