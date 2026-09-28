"""Guarded fixed-design continuation; selection artifacts are copied, never edited.

This entry is intentionally limited to the existing layered practical result.
It replays design/source binding and reads back actual geometry, rather than
trusting an old PASS or silently running a different selection experiment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time

import numpy as np

from algorithm_runtime import _recipe, _verify_artifacts
from layered_contract import verify_layered_result
from layered_runtime import _finish_layered
from m1_adapter import artifact, build_input, canonical_bytes
from m4_checks import candidate_polygons
from m4_runtime import validate_output_root
from monochrome_policy import POLICY
from practical_runtime import _prepare_and_search


def _read(path):
    return json.loads(path.read_text('utf-8'))


def run_saved_design(*, source_run: Path, output_root: Path):
    source = Path(source_run).resolve()
    output = validate_output_root(Path(output_root), [source])
    if source in output.parents:
        raise ValueError('increment output must not be inside the read-only source run')
    old_wire = _read(source/'fabrication-result.json')
    old_recipe = _read(source/'algorithm-recipe.json')
    if (old_wire['schemaVersion'] != 'fabrication.layered-result/1'
            or old_recipe.get('experimentalQuality', {}).get('mode') != 'practical-auto'):
        raise ValueError('saved continuation requires actual layered practical selection')
    m4_source = source/'m4'
    originals = {p.relative_to(m4_source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(m4_source.rglob('*')) if p.is_file()}
    if any(p.is_symlink() for p in m4_source.rglob('*')):
        raise ValueError('saved design must not contain symlink inputs')
    started = time.perf_counter()
    phase_started = started
    stage_seconds = {}

    def phase(name):
        nonlocal phase_started
        now = time.perf_counter()
        stage_seconds[name] = now-phase_started
        phase_started = now

    output.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(m4_source, output/'m4')
        shutil.copyfile(source/'algorithm-recipe.json', output/'algorithm-recipe.json')
        # This recomputes labels/raw-boundary Component binding and the selected
        # design from its original source/config. Writes occur only in our copy.
        _verify_artifacts(output, old_wire['payload']['input'], None)
        m4 = _read(output/'m4/report.json')
        with np.load(output/'m4/structural_label_map.npz') as arrays:
            labels = arrays['labels'].copy()
        observed = candidate_polygons(_read(output/'m4/observed-candidates.json'),
            _read(output/'m4/boundary-graph.json'), _read(output/'m4/vector-result.json'),
            old_recipe['effectiveConfiguration']['effectiveVectorConfig']['bezier']['validationFlatnessPx'],
            point_touch_cycles=True)
        slots = {r['id']: r['colorSlotId'] for r in old_wire['payload']['input']['observedRegions']}
        for item in observed:
            item['colorSlotId'] = slots[item['regionId']]
        old_checked = verify_layered_result(old_wire, observed, labels.shape)
        if old_checked['mismatchPixelCount']:
            raise ValueError('saved baseline does not reconstruct its actual design')
        current = {name: hashlib.sha256((output/'m4'/name).read_bytes()).hexdigest() for name in originals}
        if originals != current:
            raise ValueError('saved selection changed during independent source reconstruction')
        phase('SAVED_SELECTION_REPLAY_AND_BINDING')
        # Reuse the supplied actual plan as the same-design fallback; normal
        # bounded search can still retain existing proven completion proposals.
        prepared, recommendation = _prepare_and_search(observed, output, started, POLICY,
                                                       saved_plan=old_checked['plan'])
        if recommendation['recommendedIndex'] is None:
            raise ValueError('no lawful layered conversion: legacy candidate is not new-policy completion')
        settings = dict(old_recipe['experimentalQuality'], fabricationPolicy=POLICY)
        recipe = _recipe(m4, settings)
        recipe['fixedDesignContinuation'] = {'sourceResultSha256': old_wire['identity']['sha256'],
            'sourceRecipeSha256': hashlib.sha256((source/'algorithm-recipe.json').read_bytes()).hexdigest(),
            'm4ExactByteSha256': originals, 'selectionRegeneratedForSearch': False}
        (output/'algorithm-recipe.json').write_bytes(canonical_bytes(recipe))
        input_object = build_input(output/'m4')
        input_object['artifacts'].append(artifact(output/'algorithm-recipe.json'))
        result = _finish_layered(output=output, input_object=input_object, observed=observed,
            m4=m4, labels=labels, portable=None, quality_settings=settings, started=started,
            stage_seconds=stage_seconds, phase=phase, completed=['SAVED_SELECTION_REVERIFIED'],
            image_path=source/'m4/source-snapshot.png', verify_artifacts=_verify_artifacts,
            practical_prepared=prepared, practical_recommendation=recommendation)
        if any(hashlib.sha256((m4_source/name).read_bytes()).hexdigest() != sha
               for name, sha in originals.items()):
            raise ValueError('read-only source run changed during continuation')
        return result
    except Exception as error:
        (output/'failure.json').write_bytes(canonical_bytes({'status':'FAILED',
            'errorType':type(error).__name__, 'error':str(error),
            'residualOutput':str(output), 'sourceRunWasReadOnly':True}))
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-run', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = run_saved_design(source_run=args.source_run, output_root=args.output)
    print(json.dumps({'resultSha256': result['resultSha256'],
                      'monochromeFabrication':result['monochromeFabrication']}))


if __name__ == '__main__':
    main()
