"""Bounded full-band hypotheses, not a colour-count or case-specific target.

Only directly sampled, continuous foreground cross-sections can retract weak
ownership. Both endpoints belong to reliable faces. Other boundaries, holes,
strong details and ambiguous sections cannot lend contrast to a weak band.
"""
import copy
import numpy as np
from scipy import ndimage
from skimage.segmentation import watershed

from design_color_regions import CROSS, digest
from quality_fragments import _components, _summary

VERSION = 'joint-transition-band-candidates/1'
PARAMETERS = {'maxGlobalCandidates': 3, 'maxCorrectionRounds': 1,
              'maxGlobalCrossSections': 2048, 'maxCrossSectionWidthPx': 32,
              'endpointSamples': 3, 'maxMixtureChannelResidual': 6.0,
              'maxReverseFraction': 0.08, 'maxLargeStepFraction': 0.60,
              'minimumBandWidthPx': 2, 'minimumEndpointRgbDistance': 12.0}


def _runs(mask):
    """All cross-sections in deterministic axis/row order, sampled globally."""
    rows=[]
    for axis in (0,1):
        view=mask if axis==0 else mask.T
        for row in range(view.shape[0]):
            changes=np.diff(np.r_[False,view[row],False].astype(np.int8))
            for lo,hi in zip(np.flatnonzero(changes==1),np.flatnonzero(changes==-1)):
                if PARAMETERS['minimumBandWidthPx'] <= hi-lo <= PARAMETERS['maxCrossSectionWidthPx']:
                    rows.append((axis,row,int(lo),int(hi)))
    if len(rows)>PARAMETERS['maxGlobalCrossSections']:
        rows=[rows[i] for i in np.linspace(0,len(rows)-1,PARAMETERS['maxGlobalCrossSections'],dtype=int)]
    return rows


def changed_runs(base, value):
    """Lossless actual candidate differences; each [y,x0,x1,label] is half-open."""
    out=[]
    for y in np.flatnonzero(np.any(base!=value,axis=1)):
        x=0
        while x<base.shape[1]:
            if base[y,x]==value[y,x]: x+=1;continue
            lo=x;label=int(value[y,x]);x+=1
            while x<base.shape[1] and base[y,x]!=value[y,x] and value[y,x]==label:x+=1
            out.append([int(y),lo,x,label])
    return out


def compare_bands(rgb, active, nearest, markers, gradient, selected, components):
    # Evidence identities are recomputed from real connected ownership, not
    # looked up by saved coordinates, file names or preassigned numeric labels.
    weak=np.zeros_like(active)
    for index in np.unique(nearest[active]):
        count,cc,stats,_=_components(active&(nearest==index))
        evidence=[r for r in components if r['designLabel']==int(index+1)]
        if len(evidence)!=count-1:raise ValueError('component evidence does not cover actual ownership')
        for cid,row in enumerate(evidence,1):
            x,y,w,h,area=map(int,stats[cid])
            if row['bbox']!=[x,y,w,h] or row['areaPixels']!=area:
                raise ValueError('component evidence differs from actual connected domain')
            if not (row['surfaceCore'] or row['coherentDetail'] or row['independentForeground']):
                weak |= cc==cid
    trusted=active&~weak
    target=np.zeros_like(selected)
    votes=np.zeros(active.shape,np.int32)
    conflicts=np.zeros_like(active)
    sampled=[]
    for axis,row,lo,hi in _runs(weak):
        rv=rgb if axis==0 else rgb.transpose(1,0,2)
        nv=nearest if axis==0 else nearest.T
        sv=selected if axis==0 else selected.T
        tv=trusted if axis==0 else trusted.T
        av=active if axis==0 else active.T
        if lo<3 or hi+3>av.shape[1]:continue
        left=slice(lo-3,lo);right=slice(hi,hi+3)
        if not (tv[row,left].all() and tv[row,right].all() and av[row,lo:hi].all()):continue
        ll=int(sv[row,lo-1])-1;rr=int(sv[row,hi])-1
        if ll==rr or not ((sv[row,left]==ll+1).all() and (sv[row,right]==rr+1).all()):continue
        if not ((nv[row,left]==nv[row,lo-1]).all() and (nv[row,right]==nv[row,hi]).all()):continue
        aa=np.median(rv[row,left],axis=0).astype(float)
        bb=np.median(rv[row,right],axis=0).astype(float)
        delta=bb-aa;norm=float(delta@delta)
        if norm<PARAMETERS['minimumEndpointRgbDistance']**2:continue
        samples=rv[row,lo:hi].astype(float)
        fractions=(samples-aa)@delta/norm
        residual=np.abs(samples-aa-fractions[:,None]*delta).max(axis=1)
        steps=np.diff(np.r_[0.0,fractions,1.0])
        # A real narrow plateau with two sharp edges is a separate hypothesis,
        # even if its colour happens to lie on the endpoint mixture segment.
        plateau=(len(fractions)>=2 and np.ptp(fractions)<=0.10 and
                 min(float(fractions[0]),float(1-fractions[-1]))>=0.20)
        mixture=(np.max(residual)<=PARAMETERS['maxMixtureChannelResidual'] and
                 np.min(steps)>=-PARAMETERS['maxReverseFraction'] and
                 np.max(steps)<=PARAMETERS['maxLargeStepFraction'] and
                 np.min(fractions)>=-0.03 and np.max(fractions)<=1.03)
        accepted=bool(mixture and not plateau)
        coords=[[row,x] if axis==0 else [x,row] for x in range(lo-3,hi+3)]
        sampled.append({'axis':axis,'positionsYX':coords,'crossedLabels':(nv[row,lo-3:hi+3]+1).tolist(),
                        'endpointRgb':[aa.tolist(),bb.tolist()], 'mixtureFractions':fractions.tolist(),
                        'maxChannelResidual':float(np.max(residual)),'independentPlateau':bool(plateau),
                        'acceptedTransition':accepted})
        if not accepted:continue
        labels=np.where(fractions<0.5,ll+1,rr+1)
        for offset,label in enumerate(labels):
            y,x=(row,lo+offset) if axis==0 else (lo+offset,row)
            if votes[y,x] and target[y,x]!=label:conflicts[y,x]=True
            target[y,x]=label;votes[y,x]+=1
    supported=weak&(votes>0)&~conflicts
    records=[];candidates=[('KEEP',selected.copy())]
    if supported.any():
        split_markers=markers.copy();split_markers[supported]=target[supported]
        solved=watershed(gradient,split_markers,connectivity=CROSS,mask=active).astype(np.int32)
        split=selected.copy();split[supported]=solved[supported]
        merge_markers=markers.copy()
        count,cc,_,_=_components(supported)
        for cid in range(1,count):
            part=cc==cid
            labels,counts=np.unique(target[part],return_counts=True)
            # Resolve an equal-contact merge by measured colour, never ordinal
            # confidence. This remains an alternative, not a preferred answer.
            tied=labels[counts==counts.max()]
            chosen=min(tied,key=lambda label:tuple(np.median(rgb[trusted&(selected==label)],axis=0)))
            merge_markers[part]=chosen
        merged=watershed(gradient,merge_markers,connectivity=CROSS,mask=active).astype(np.int32)
        merge=selected.copy();merge[supported]=merged[supported]
        candidates.extend([('MERGE_ADJACENT',merge),('TWO_SIDE',split)])
    best=None;known={}
    for name,labels in candidates:
        mismatch=int(np.count_nonzero((labels!=selected)&~supported))
        unmet=int(np.count_nonzero(supported&(labels!=target)))
        counts=_summary(labels)
        # Structure outside the direct evidence is a hard constraint. Within
        # the band, measured cross-section ownership outranks piece economy.
        rank=(mismatch,unmet,counts['components'],int(np.count_nonzero(labels!=selected)))
        checksum=digest(labels)
        records.append({'name':name,'labelsSha256':checksum,'sameAs':known.get(checksum),
                        'changedPixels':int(np.count_nonzero(labels!=selected)),
                        'changesYXRangeLabel':changed_runs(selected,labels),'summary':counts,
                        'rankingKey':list(rank),'protectedStructureChanged':mismatch,
                        'unsupportedCrossSectionOwnershipPixels':unmet})
        known.setdefault(checksum,name)
        if best is None or rank<best[0]:best=(rank,name,labels)
    return best[2], {'version':VERSION,'parameters':copy.deepcopy(PARAMETERS),
        'sampledCrossSections':sampled,'globalSampleCount':len(sampled),
        'weakPixels':int(weak.sum()),'supportedTransitionPixels':int(supported.sum()),
        'conflictingPixelsRetained':int(conflicts.sum()),'candidates':records,'selected':best[1],
        'selectedSha256':digest(best[2]),'keepSha256':digest(selected),
        'labelShape':list(selected.shape),'keepLabelsYXRangeLabel':changed_runs(np.zeros_like(selected),selected),
        'manualQualityStatus':'PENDING_MANUAL_REVIEW','truthFromReference':False}
