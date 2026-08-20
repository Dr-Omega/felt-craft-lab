# -*- coding: utf-8 -*-
from pathlib import Path
from psd_tools import PSDImage

psd = PSDImage.open(Path(r"C:\Users\xingx\Desktop\160 - 副本.psd"))

def walk(layer, depth=0):
    indent = "  " * depth
    kind = "group" if layer.is_group() else layer.kind
    bbox = layer.bbox
    n = 0
    if not layer.is_group():
        img = layer.composite(force=True)
        if img is not None:
            n = sum(1 for p in img.convert("RGBA").getdata() if p[3] > 10)
    print(f"{indent}{layer.name!r} kind={kind} visible={layer.visible} bbox={bbox} pixels={n}")
    if layer.is_group():
        for child in layer:
            walk(child, depth + 1)

for layer in psd:
    walk(layer)
