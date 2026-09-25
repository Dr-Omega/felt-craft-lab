"""Serial full-resolution design-colour ablations and known-design controls."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import traceback
import numpy as np
from PIL import Image
from algorithm_runtime import run_algorithm
from m1_adapter import canonical_bytes
from m4_runtime import validate_output_root
from design_color_controls import control,validation_design
from quality_fragments import _summary

HERE=Path(__file__).resolve().parent
BASE='a85fb5102157d56fd8fc74d597f0ccf840b84236'
REAL={'crescent':('FLD-001.png',[[3,3,3],[249,207,0]]),
      'envelope':('FLD-002.png',[[3,3,3],[249,74,49],[252,194,67]]),
      'mooncake':('FLD-003.png',[[229,180,124],[254,249,200]])}
VARIANTS={'baseline':('baseline',False,False),'cleanup-only':('design-cleanup',True,False),
          'colors-only':('design-colors',False,False),'combined':('design-colors',True,False),
          'reference':('design-colors',True,True)}

def read(path):return json.loads(path.read_text('utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def run(output,*,cases=None,variants=None,controls=False):
    selected=list(REAL) if cases is None else cases
    if not selected or any(c not in REAL for c in selected):raise ValueError('unknown real case')
    names=list(VARIANTS) if variants is None else variants
    if any(v not in VARIANTS for v in names):raise ValueError('unknown variant')
    sources=[HERE.parent/'fixtures/source'/REAL[c][0] for c in selected]
    output=validate_output_root(output,sources);output.mkdir(parents=True,exist_ok=True)
    jobs=[]
    if not controls:
        for case,source in zip(selected,sources):
            for variant in names:
                jobs.append((case,variant,source,REAL[case][1],None,'REAL_PROJECT_DEVELOPMENT_REUSE_NOT_HOLDOUT'))
    else:
        inputs=output/'inputs';inputs.mkdir()
        for family,count in (('tiles5',5),('tiles6',6),('ribbons9',9)):
            for perturbation in ('clean','texture','tint','edge'):
                rgba,truth,palette=validation_design(perturbation) if family=='ribbons9' else control(count,perturbation)
                case=family+'-'+perturbation;source=inputs/(case+'.png')
                Image.fromarray(rgba).save(source);np.savez_compressed(inputs/(case+'-truth.npz'),labels=truth)
                variants_for_input=names if perturbation=='clean' else ['combined','reference']
                for variant in variants_for_input:
                    jobs.append((case,variant,source,palette,truth,'SYNTHETIC_KNOWN_DESIGN_VALIDATION' if family=='ribbons9' else 'SYNTHETIC_KNOWN_DESIGN_DEVELOPMENT'))
    repo=HERE.parents[2]
    summary={'schemaVersion':'design-color-evaluation/1','baseSha':BASE,
        'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
        'worktreeDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip()),
        'variants':VARIANTS,'evaluationPolicy':'Full resolution; serial; perturbations grouped by design, never independent samples.',
        'humanVisualAcceptance':'PENDING','manufacturing':'NOT_EVALUATED','productionExportEligible':False,'records':[]}
    for case,variant,source,palette,truth,origin in jobs:
        mode,cleanup,reference=VARIANTS[variant];target=output/(case+'--'+variant)
        options={'design_palette':palette,'palette_provenance':'Known synthetic construction' if truth is not None else 'Diagnostic reference chosen from old dominant input colours, NOT ground truth or manual approval'} if reference else {}
        record={'case':case,'variant':variant,'sourceKind':origin,'sourcePath':str(source),'inputSha256':sha(source),
            'outputDirectory':target.name,'paletteMode':'REFERENCE' if reference else ('AUTO' if mode!='baseline' else 'FROZEN_BASELINE'),
            'referencePalette':palette if reference else None,'referenceInformationSource':options.get('palette_provenance'),
            'configuration':{'qualityMode':mode,'foregroundCleanup':cleanup,'profile':'aggressive','seamStrategy':'baseline'},
            'designFamily':case.split('-')[0],'truthAvailable':truth is not None,'AtoBManualQuality':'PENDING_MANUAL_REVIEW',
            'falseMerge':None,'falseSplit':None,'keyDetailQuality':None,'status':'STARTED'}
        print('START '+target.name,flush=True);start=time.perf_counter()
        try:
            report=run_algorithm(image_path=source,output_root=target,foreground_source=origin,quality_mode=mode,foreground_cleanup=cleanup,**options)
            m4=read(target/'m4/report.json');regions=read(target/'m4/regions.json');result=read(target/'fabrication-result.json')
            with np.load(target/'m4/structural_label_map.npz') as a: labels=a['labels'].copy()
            record.update(status='COMPLETE',resultSha256=report['resultSha256'],
                designColorCount=len({tuple(r['representativeColorRgb']) for r in regions}),regionCount=len(regions),componentCount=_summary(labels)['components'],
                baseCount=sum(p['role']=='BASE' for p in result['payload']['pieces']),visibleCount=sum(p['role']=='VISIBLE' for p in result['payload']['pieces']),
                geometryChecks=report['rerenderChecks'],m4Stages=m4['stages'],execution=read(target/'execution.json'))
            if mode!='baseline':
                d=read(target/'m4/experimental-design.json')
                record.update(cleanupPixels=d['derivedAlphaChangedPixels'],labelDifferencePixels=int(d['selection'].get('labelDifferencePixelCount',0)),
                    cleanupProposal=d['cleanup']['manualConfirmation'],originalCounts=_summary(np.load(target/'m4/baseline-analysis.npz')['structural']),
                    paletteProposal=d['selection'].get('paletteProposal'),spatialReownership=d['selection'].get('spatialReownership'))
            else:record.update(cleanupPixels=0,labelDifferencePixels=0)
            if truth is not None:
                from scipy.optimize import linear_sum_assignment
                ids=sorted(np.unique(truth[truth>0]));new=sorted(np.unique(labels[labels>0]))
                overlap=np.array([[np.count_nonzero((truth==a)&(labels==b)) for b in new] for a in ids])
                rows,cols=linear_sum_assignment(-overlap)
                record['knownDesignMetrics']={'truthColors':len(ids),'truthComponents':_summary(truth)['components'],
                    'unmatchedOrMisassignedStructuralPixels':int(np.count_nonzero(truth)-overlap[rows,cols].sum()),
                    'missingSupportPixels':int(np.count_nonzero((truth>0)&(labels==0))),
                    'extraSupportPixels':int(np.count_nonzero((truth==0)&(labels>0))),
                    'labelAssignmentMapping':[[int(ids[a]),int(new[b])] for a,b in zip(rows,cols)],
                    'meaning':'Known synthetic label truth, not real-image visual acceptance'}
        except Exception as error:
            record.update(status='FAILED',errorType=type(error).__name__,error=str(error));traceback.print_exc()
        record['endToEndSeconds']=time.perf_counter()-start
        record['sourceUnchanged']=sha(source)==record['inputSha256']
        if not record['sourceUnchanged']:raise RuntimeError('source changed')
        summary['records'].append(record);(output/'RESULTS.json').write_bytes(canonical_bytes(summary))
        print(json.dumps({k:record[k] for k in ('case','variant','status','endToEndSeconds')}|{k:record[k] for k in ('designColorCount','componentCount','baseCount','visibleCount','error') if k in record}),flush=True)
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--case',action='append',choices=REAL);p.add_argument('--variant',action='append',choices=VARIANTS);p.add_argument('--controls',action='store_true')
    a=p.parse_args();report=run(a.output,cases=a.case,variants=a.variant,controls=a.controls)
    raise SystemExit(int(any(r['status']=='FAILED' for r in report['records'])))
