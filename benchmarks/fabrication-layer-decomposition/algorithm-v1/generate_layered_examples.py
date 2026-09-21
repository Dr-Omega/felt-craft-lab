"""Legitimate DEVELOPMENT layered sources; these are not project or signed GT files."""
from pathlib import Path
import struct

import numpy as np


def development_svg() -> bytes:
    return b'''<svg xmlns="http://www.w3.org/2000/svg" width="48" height="40" viewBox="0 0 48 40">
<title>DEVELOPMENT synthetic overlap; no human review</title>
<g id="explicit-foreground" transform="translate(4 4)">
  <rect id="red-back" x="0" y="0" width="30" height="28" fill="#d03030"/>
  <path id="blue-front" d="M 14 8 L 38 8 L 38 32 L 14 32 Z" fill="#2050d0"/>
</g></svg>'''


def development_psd(*, blend=b"norm", compressed=False, feature_key=None) -> bytes:
    """Two true layer records, independent pixel channels and valid merged image.

    Rectangles equal development_svg. PSD stores topmost record first. RLE mode
    writes valid PackBits literal rows, keeping the fixture intentionally simple.
    """
    pack=lambda fmt,*args: struct.pack(">"+fmt,*args)
    block=lambda b: pack("I",len(b))+b
    h,w=40,48
    records=[]; channel_data=[]; composite=np.zeros((h,w,4),np.uint8)
    specs=[("blue-front",12,18,24,24,(32,80,208)),("red-back",4,4,30,28,(208,48,48))]
    for name,top,left,lw,lh,color in reversed(specs):
        composite[top:top+lh,left:left+lw,:3]=color; composite[top:top+lh,left:left+lw,3]=255
    for name,top,left,lw,lh,color in specs:
        channels=[]
        for value in (*color,255):
            if compressed:
                row=bytes([lw-1])+bytes([value])*lw
                data=pack("H",1)+pack("H"*lh,*([len(row)]*lh))+row*lh
            else: data=pack("H",0)+bytes([value])*(lw*lh)
            channels.append(data)
        encoded=name.encode("mac_roman"); pascal=bytes([len(encoded)])+encoded; pascal+=b"\0"*((-len(pascal))%4)
        extra=block(b"")+block(b"")+pascal
        if feature_key is not None:
            extra+=b"8BIM"+feature_key+block(pack("I",1))
        rec=pack("iiiiH",top,left,top+lh,left+lw,4)
        for cid,data in zip((0,1,2,-1),channels): rec+=pack("hI",cid,len(data))
        rec+=b"8BIM"+blend+bytes([255,0,0,0])+block(extra)
        records.append(rec); channel_data.extend(channels)
    info=pack("h",len(records))+b"".join(records+channel_data); info+=b"\0"*(len(info)%2)
    layer_mask=block(info)+block(b"")
    header=b"8BPS"+pack("H",1)+b"\0"*6+pack("HIIHH",4,h,w,8,3)
    merged=pack("H",0)+b"".join(composite[:,:,i].tobytes() for i in range(4))
    return header+block(b"")+block(b"")+block(layer_mask)+merged


def write_examples(output: Path):
    """Explicit development-only generator, refuses existing destinations."""
    output=Path(output)
    if output.exists() and any(output.iterdir()): raise ValueError("Example output must be empty")
    output.mkdir(parents=True,exist_ok=True)
    (output/"development-overlap.svg").write_bytes(development_svg())
    (output/"development-overlap.psd").write_bytes(development_psd())
    (output/"development-unsupported-blend.psd").write_bytes(development_psd(blend=b"mul "))
    (output/"development-unsupported-filter.svg").write_bytes(development_svg().replace(b'fill="#2050d0"',b'fill="#2050d0" filter="url(#blur)"'))
    (output/"PROVENANCE.txt").write_text("DEVELOPMENT_SYNTHETIC: generated legal PSD/SVG source files; no project-real layered asset, no manual GT/signature. Explicit foreground selection: SVG explicit-foreground; PSD * (all pixel layers).\n",encoding="utf-8")


if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument("output",type=Path)
    write_examples(parser.parse_args().output)
