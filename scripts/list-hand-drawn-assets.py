# -*- coding: utf-8 -*-
from pathlib import Path

src = Path(r"C:\Users\xingx\Desktop\新建文件夹 (2)")
for f in sorted(src.iterdir()):
    if f.suffix.lower() in {".png", ".jpg", ".webp"}:
        print(f.name)
