"""Verify the pinned source pack, then add two byte-preserving staging aliases.

Run only on a disposable copy of content/material-assets-v2, never old evidence.
The alias map is independently corroborated by the already-published UI pack.
"""
import argparse
import hashlib
import json
from pathlib import Path


def prepare(source: Path) -> None:
    mapping = json.loads((Path(__file__).resolve().parents[1] / 'docs/material-v2-source-map.json').read_text(encoding='utf-8'))
    source = source.resolve(strict=True)
    for entry in mapping['sourceFiles']:
        target = (source / entry['path']).resolve(strict=True)
        if not target.is_relative_to(source):
            raise ValueError('Source path escaped staging root')
        data = target.read_bytes()
        digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if digest != entry['blobSha'] or len(data) != entry['size']:
            raise ValueError('Source bytes differ: ' + entry['path'])
    pending = []
    for alias in mapping['aliases']:
        data = (source / alias['sourcePath']).read_bytes()
        destination = (source / alias['destinationPath']).resolve()
        if not destination.is_relative_to(source):
            raise ValueError('Alias escaped staging root')
        if destination.exists():
            if destination.read_bytes() != data:
                raise ValueError('Alias conflicts with existing file: ' + str(destination))
        else:
            pending.append((destination, data))
    for destination, data in pending:
        with destination.open('xb') as output:
            output.write(data)
    print(json.dumps({'verifiedSourceFiles': len(mapping['sourceFiles']), 'aliasesAdded': len(pending)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    prepare(parser.parse_args().source)
