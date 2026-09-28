"""Guarded continuation from an independently verifiable, already-bound M4.

This avoids rerunning selection to test backing on earlier design modes. It
does not migrate unbound old evidence, accept a PASS flag, or smooth contours.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time

import numpy as np

from algorithm_runtime import _recipe, _verify_artifacts
from layered_runtime import _finish_layered
from m1_adapter import artifact, build_input, canonical_bytes
from m4_checks import candidate_polygons
from m4_runtime import validate_output_root
from whole_silhouette import RULE
from practical_runtime import _prepare_and_search


def run_saved_m4(*, m4_root, output_root, base_color_slot=None):
    source = Path(m4_root).resolve()
    output = validate_output_root(Path(output_root), [source])
    if source in output.parents:
        raise ValueError('output cannot be within the read-only M4 source')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('symlink M4 sources are not accepted')
    originals = {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in source.rglob('*') if p.is_file()}
    if not originals or 'component-binding.json' not in originals:
        raise ValueError('requires already bound M4 source artifacts')
    started = phase_start = time.perf_counter()
    timings = {}
    def phase(name):
        nonlocal phase_start
        now = time.perf_counter(); timings[name] = now-phase_start; phase_start = now
    output.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(source, output/'m4')
        input_object = build_input(output/'m4')  # actual labels, raw edges, source and design replay
        m4 = json.loads((output/'m4/report.json').read_text('utf-8'))
        config = m4['configuration']
        mode = (m4.get('experimentalDesign') or {}).get('mode', 'baseline')
        observed = candidate_polygons(*[json.loads((output/'m4'/name).read_text('utf-8')) for name in
            ('observed-candidates.json','boundary-graph.json','vector-result.json')],
            config['effectiveVectorConfig']['bezier']['validationFlatnessPx'],
            point_touch_cycles=mode in {'design-colors','layered-selection','practical-auto'})
        slots = {r['id']:r['colorSlotId'] for r in input_object['observedRegions']}
        for item in observed: item['colorSlotId'] = slots[item['regionId']]
        with np.load(output/'m4/structural_label_map.npz') as arrays: labels = arrays['labels'].copy()
        phase('SAVED_M4_INDEPENDENT_SOURCE_AND_DESIGN_REPLAY')
        prepared, recommendation = _prepare_and_search(observed, output, started, RULE,
                                                       base_color_slot=base_color_slot)
        settings = {'version':'application-quality/1', 'mode':mode, 'fabricationPolicy':RULE,
                    'baseColorSlotId':base_color_slot, 'savedM4Continuation':True,
                    'humanConfirmation':'PENDING_REVIEW'}
        recipe = _recipe(m4, settings)
        recipe['fixedDesignContinuation'] = {'m4ExactByteSha256':originals, 'selectionRegeneratedForSearch':False}
        (output/'algorithm-recipe.json').write_bytes(canonical_bytes(recipe))
        input_object['artifacts'].append(artifact(output/'algorithm-recipe.json'))
        (output/'practical-selection.json').write_bytes(canonical_bytes(recommendation))
        result = _finish_layered(output=output, input_object=input_object, observed=observed, m4=m4,
            labels=labels, portable=None, quality_settings=settings, started=started, stage_seconds=timings,
            phase=phase, completed=['SAVED_M4_REVERIFIED'], image_path=source/'source-snapshot.png',
            verify_artifacts=_verify_artifacts, practical_prepared=prepared, practical_recommendation=recommendation)
        if any(hashlib.sha256((source/name).read_bytes()).hexdigest()!=sha or
               hashlib.sha256((output/'m4'/name).read_bytes()).hexdigest()!=sha for name,sha in originals.items()):
            raise ValueError('saved selection bytes changed')
        return result
    except Exception as error:
        (output/'failure.json').write_bytes(canonical_bytes({'status':'FAILED', 'error':str(error),
            'errorType':type(error).__name__, 'sourceReadOnly':True}))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--m4-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--base-color-slot')
    args = parser.parse_args()
    report = run_saved_m4(m4_root=args.m4_root, output_root=args.output, base_color_slot=args.base_color_slot)
    print(json.dumps({'resultSha256':report['resultSha256'], 'backing':report['wholeSilhouetteBase']['representation']}))
