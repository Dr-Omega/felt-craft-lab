"""Read-only old/new geometry and rank comparison; write a new evidence file."""
import argparse
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def compare(old, new):
    before, after = read(old / 'examples.json'), read(new / 'examples.json')
    assert len(before) == len(after) == 9, 'all original cases must run'
    results = []
    for a, b in zip(before, after):
        name = a['id']
        assert name == b['id'] and a['status'] == b['status'], name
        assert a['sourceSha256'] == b['sourceSha256'], (name, 'source changed')
        if a['status'] == 'EXPECTED_UNSUPPORTED':
            assert not (new / name / 'fabrication-result.json').exists()
            results.append({'id': name, 'status': a['status'], 'parity': 'PASS'})
            continue
        assert a['status'] == 'COMPLETE', name
        for filename in ('fabrication-geometry.json', 'candidate-comparison.json'):
            assert read(old / name / filename) == read(new / name / filename), (name, filename)
        old_payload = read(old / name / 'fabrication-result.json')['payload']
        new_payload = read(new / name / 'fabrication-result.json')['payload']
        for field in ('pieces', 'splitGroups', 'baseExposures'):
            assert old_payload[field] == new_payload[field], (name, field)
        for field in ('selectedPlanId', 'pieceCount', 'splitGroupCount', 'seamScore'):
            assert a[field] == b[field], (name, field)
        checks = read(new / name / 'geometry-checks.json')
        assert checks['mismatchPixelCount'] == 0
        geometry = checks['geometryChecks']
        assert geometry['splitDeclarationCompleteness'] == 'PASS'
        parents = geometry['actualParents']
        assert all(p['declarationMatch'] == 'PASS' for p in parents)
        assert sum(p['splitRequired'] for p in parents) == len(new_payload['splitGroups'])
        assert sum(p['physicalSeamRecordCount'] for p in parents) == b['seamScore']['physicalSeamRecordCount']
        results.append({'id': name, 'status': 'COMPLETE', 'parity': 'PASS',
            'baseCount': sum(p['role'] == 'BASE' for p in new_payload['pieces']),
            'visibleCount': sum(p['role'] == 'VISIBLE' for p in new_payload['pieces']),
            'requiredSplitGroups': sum(p['splitRequired'] for p in parents),
            'actualParents': parents, 'seamScore': b['seamScore'], 'mismatchPixelCount': 0,
            'selectedPlanId': b['selectedPlanId'], 'candidateCount': len(read(new / name / 'candidate-comparison.json'))})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--new', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.baseline, args.new)
    with args.report.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'parity': 'PASS', 'successCases': 8, 'expectedRejectionCases': 1, 'report': str(args.report)}))
