# -*- coding: utf-8 -*-
from pathlib import Path
from psd_tools import PSDImage
from PIL import Image

psd = PSDImage.open(Path(r"C:\Users\xingx\Desktop\160 - 副本.psd"))
full = psd.composite()
print("full composite", full.size)
for name in ("书本", "画框", "3d投影屏", "狐狸按钮"):
    layer = next(l for l in psd.descendants() if l.name == name)
    b = layer.bbox
    crop = full.crop(b)
    n = sum(1 for p in crop.convert("RGBA").getdata() if p[3] > 10)
    print(name, "crop pixels", n, "bbox", b)
