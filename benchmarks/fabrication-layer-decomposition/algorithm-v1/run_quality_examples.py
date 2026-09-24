"""Serial real-source four-way quality comparison; no holdout or frozen writes."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

from algorithm_runtime import run_algorithm
from m1_adapter import canonical_bytes
from m4_runtime import validate_output_root

HERE=Path(__file__).resolve().parent
BENCHMARK=HERE.parent
CASES={'crescent':'FLD-001.png','envelope':'FLD-002.png','mooncake':'FLD-003.png'}
VARIANTS=(('baseline','baseline',False,'compare'),('selection','selection',False,'baseline'),
          ('contour','contour',False,'baseline'),('combined','combined',False,'visual-proxy'))


def run_quality_examples(output, *, case_ids=None):
    cases=list(CASES) if case_ids is None else list(case_ids)
    if not cases or any(c not in CASES for c in cases) or len(set(cases)) != len(cases):
        raise ValueError('unique declared real development cases required')
    sources=[BENCHMARK/'fixtures/source'/CASES[c] for c in cases]
    output=validate_output_root(Path(output),sources)
    output.mkdir(parents=True,exist_ok=True)
    repo=HERE.parents[2]
    records=[]
    metadata={'schemaVersion':'application-quality-examples/1',
              'baseSha':'bf1bc12e6d433525f63fdc60e57ce5101ac9e2d4',
              'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
              'worktreeDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip()),
              'sourcePolicy':'PROJECT_REAL_READ_ONLY_DEVELOPMENT_REUSE_NOT_HOLDOUT',
              'variants':[list(v) for v in VARIANTS],
              'baselineMeaning':'Original algorithm with optional diagnostic comparison; original ranking unchanged',
              'acceptance':{'userVisual':'PENDING','manufacturing':'NOT_EVALUATED','productionExportEligible':False},
              'records':records}
    for case,source in zip(cases,sources,strict=True):
        variants=list(VARIANTS)
        if case=='crescent': variants.append(('combined-cleanup','combined',True,'visual-proxy'))
        if case=='mooncake': variants.append(('seam-only','baseline',False,'visual-proxy'))
        for name,mode,cleanup,seams in variants:
            target=output/(case+'--'+name)
            started=time.perf_counter()
            digest=hashlib.sha256(source.read_bytes()).hexdigest()
            record={'case':case,'variant':name,'qualityMode':mode,'cleanup':cleanup,'seamStrategy':seams,
                    'sourceName':source.name,'sourceSha256':digest,'outputDirectory':target.name}
            print('START '+target.name,flush=True)
            try:
                report=run_algorithm(image_path=source,output_root=target,
                    foreground_source=metadata['sourcePolicy'],quality_mode=mode,
                    foreground_cleanup=cleanup,seam_strategy=seams)
                m4=json.loads((target/'m4/report.json').read_text('utf-8'))
                result=json.loads((target/'fabrication-result.json').read_text('utf-8'))
                record.update(status='COMPLETE',resultSha256=report['resultSha256'],
                    regionCount=m4['counts']['localRegionCount'],componentCount=m4['counts']['geometryComponentCount'],
                    baseCount=sum(p['role']=='BASE' for p in result['payload']['pieces']),
                    visibleCount=sum(p['role']=='VISIBLE' for p in result['payload']['pieces']),
                    selectedPlanId=report['selectedPlanId'],seamScore=report['seamScore'],
                    rerenderChecks=report['rerenderChecks'],originalToPurified=report['originalToPurified'],
                    m4Stages=m4['stages'],execution=json.loads((target/'execution.json').read_text('utf-8')))
                if mode!='baseline':
                    design=json.loads((target/'m4/experimental-design.json').read_text('utf-8'))
                    record['selection']={k:design['selection'][k] for k in ('before','after','changedComponentCount','changedStructuralPixelCount')}
                    record['cleanupProposal']={k:design['cleanup'][k] for k in ('removedIslandCount','changedAlphaPixelCount','manualConfirmation')}
                    record['contours']={k:design['contours'][k] for k in ('status','baselineSegmentCount','selectedSegmentCount','changedRasterPixelCount','changedRasterBbox')}
                    record['contours']['changedEdgeCount']=len(design['contours']['changedEdges'])
            except Exception as error:
                record.update(status='FAILED',errorType=type(error).__name__,error=str(error))
            record['endToEndSeconds']=time.perf_counter()-started
            record['sourceUnchanged']=hashlib.sha256(source.read_bytes()).hexdigest()==digest
            if not record['sourceUnchanged']: raise RuntimeError('read-only source changed: '+str(source))
            records.append(record)
            (output/'quality-examples.json').write_bytes(canonical_bytes(metadata))
            print(json.dumps({k:v for k,v in record.items() if k not in ('execution','m4Stages','rerenderChecks')},ensure_ascii=False),flush=True)
    return metadata


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--case',action='append',choices=list(CASES))
    args=parser.parse_args()
    report=run_quality_examples(args.output,case_ids=args.case)
    raise SystemExit(1 if any(r['status']!='COMPLETE' for r in report['records']) else 0)
