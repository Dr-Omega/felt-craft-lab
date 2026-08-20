# -*- coding: utf-8 -*-
from pathlib import Path
from psd_tools import PSDImage

psd = PSDImage.open(Path(r"C:\Users\xingx\Desktop\160 - 副本.psd"))
for layer in psd.descendants():
    if "范围" in layer.name or layer.name in ("书本", "画框", "3d投影屏"):
        b = layer.bbox
        print(
            f"{layer.name}: left={b[0]} top={b[1]} right={b[2]} bottom={b[3]} "
            f"w={b[2]-b[0]} h={b[3]-b[1]}"
        )
