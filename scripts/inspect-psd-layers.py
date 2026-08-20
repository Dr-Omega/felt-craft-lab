# -*- coding: utf-8 -*-
from pathlib import Path
from psd_tools import PSDImage

psd = PSDImage.open(Path(r"C:\Users\xingx\Desktop\160 - 副本.psd"))
for layer in psd.descendants():
    if layer.is_group():
        continue
    img = layer.composite(force=True)
    if img is None:
        continue
    n = sum(1 for p in img.convert("RGBA").getdata() if p[3] > 10)
    if n > 0 or "范围" in layer.name or layer.name in ("书本", "画框", "3d投影屏"):
        print(
            repr(layer.name),
            "visible",
            layer.visible,
            "bbox",
            layer.bbox,
            "pixels",
            n,
            "kind",
            layer.kind,
        )
