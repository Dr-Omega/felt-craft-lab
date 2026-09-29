"""Explicit straight original RGB + saved alpha; no inference or decontamination."""
from io import BytesIO
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image

VERSION = 'decoded-original-rgb-saved-alpha/1'
ARTIFACTS = ('handoff-original.bin', 'handoff-alpha.png', 'handoff-straight.png')


def prepare(source_bytes, alpha_bytes):
    """Pure decode in mask coordinates. Never guess encoding or divide by alpha."""
    with Image.open(BytesIO(source_bytes)) as source, Image.open(BytesIO(alpha_bytes)) as alpha:
        if source.format not in {'JPEG', 'PNG'} or getattr(source, 'n_frames', 1) != 1:
            raise ValueError('saved-alpha handoff supports single-frame JPEG/PNG only')
        if alpha.format != 'PNG' or alpha.mode != 'L' or getattr(alpha, 'n_frames', 1) != 1:
            raise ValueError('saved alpha must be an explicit 8-bit L PNG')
        if source.size != alpha.size:
            raise ValueError('saved alpha and original decoded frame differ')
        rgba = np.array(source.convert('RGBA'))
        rgba[..., 3] = np.array(alpha)
    stream = BytesIO()
    Image.fromarray(rgba).save(stream, format='PNG')
    derived = stream.getvalue()
    record = {'version': VERSION, 'rgbSemantics': 'STRAIGHT_DECODED_ORIGINAL_NO_ALPHA_MULTIPLICATION',
              'alphaSemantics': 'EXACT_SAVED_MASK_NO_INFERENCE',
              'backgroundColorDecontamination': False, 'frame': [rgba.shape[1], rgba.shape[0]],
              'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in
                         zip(ARTIFACTS, (source_bytes, alpha_bytes, derived))}}
    return derived, record


def verify_persisted(output, declaration):
    """Re-decode actual snapshots, not a cached PASS or mutually rehashed claim."""
    output = Path(output)
    derived, expected = prepare((output/ARTIFACTS[0]).read_bytes(), (output/ARTIFACTS[1]).read_bytes())
    if declaration != expected:
        raise ValueError('saved-alpha handoff recipe differs from independently decoded sources')
    if (output/ARTIFACTS[2]).read_bytes() != derived:
        raise ValueError('saved-alpha handoff RGB/alpha differs from declared operation')
    if (output/'m4/source-snapshot.png').read_bytes() != derived:
        raise ValueError('M4 did not consume the declared straight RGBA handoff')
    return {'status': 'PASS', 'method': 'FRESH_DECODED_RGB_AND_ALPHA_COMPARISON', 'version': VERSION}
