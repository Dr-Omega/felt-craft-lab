"""Finite, fail-closed layered source evidence. No resource fetching or script execution.

All masks use the normalized canvas; order increases from back to front. This is
authoring evidence, never a claim that a source object is a fabrication piece.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET

import numpy as np
from PIL import ImageColor

__all__ = ["parse_layered"]
MAX_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 4_000_000
MAX_LAYERS = 256
MAX_LAYER_PIXELS = 16_000_000
_NUM = r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?"


class _Unsupported(ValueError):
    pass


def _numbers(value):
    if re.sub(_NUM, "", value).strip(" ,\t\r\n"):
        raise _Unsupported("Unsupported numeric syntax")
    out = [float(v) for v in re.findall(_NUM, value)]
    if not all(math.isfinite(v) and abs(v) <= 1e8 for v in out):
        raise _Unsupported("Nonfinite or excessive numeric value")
    return out


def _num(value):
    values = _numbers(str(value))
    if len(values) != 1:
        raise _Unsupported("Expected one unitless numeric value")
    return values[0]


def _dimensions(w, h):
    if w != int(w) or h != int(h) or min(w, h) <= 0 or w*h > MAX_PIXELS:
        raise _Unsupported("Unsupported canvas dimensions/resource limit")
    return int(w), int(h)


def _affine(value):
    result = np.eye(3)
    matches = list(re.finditer(r"([A-Za-z]+)\s*\(([^)]*)\)", value))
    if re.sub(r"[A-Za-z]+\s*\([^)]*\)", "", value).strip(" ,\t\n\r"):
        raise _Unsupported("Invalid transform")
    for match in matches:
        name, args = match.group(1), _numbers(match.group(2))
        m = np.eye(3)
        if name == "matrix" and len(args) == 6:
            a,b,c,d,e,f = args
            m = np.array([[a,c,e],[b,d,f],[0,0,1]])
        elif name == "translate" and len(args) in (1,2):
            m[0,2], m[1,2] = args[0], args[1] if len(args)==2 else 0
        elif name == "scale" and len(args) in (1,2):
            m[0,0], m[1,1] = args[0], args[-1]
        elif name == "rotate" and len(args) in (1,3):
            a = math.radians(args[0]); c,s = math.cos(a),math.sin(a)
            m[:2,:2] = [[c,-s],[s,c]]
            if len(args)==3:
                p = np.array(args[1:]); m[:2,2] = p - m[:2,:2] @ p
        else:
            raise _Unsupported("Unsupported transform: " + name)
        result = result @ m
    if abs(np.linalg.det(result)) < 1e-12:
        raise _Unsupported("Singular transform")
    return result


def _paths(data):
    tokens = re.findall(r"[A-Za-z]|" + _NUM, data)
    if re.sub(r"[A-Za-z]|" + _NUM, "", data).strip(" ,\t\r\n"):
        raise _Unsupported("Invalid path tokens")
    rings, ring, pos, start = [], [], np.zeros(2), np.zeros(2)
    i, cmd = 0, None
    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]; i += 1
            if cmd not in "MmLlHhVvZz":
                raise _Unsupported("Unsupported SVG curve/path command: " + cmd)
            if cmd in "Zz":
                if len(ring)<3: raise _Unsupported("Degenerate closed path")
                rings.append(ring); ring=[]; pos=start.copy(); cmd=None
                continue
        if cmd is None: raise _Unsupported("Path lacks command")
        n = 2 if cmd.upper() in "ML" else 1
        if i+n>len(tokens) or any(x.isalpha() for x in tokens[i:i+n]):
            raise _Unsupported("Truncated SVG path")
        vals = _numbers(" ".join(tokens[i:i+n])); i += n
        if cmd.upper() in "ML":
            p = np.array(vals)
            if cmd.islower(): p += pos
        else:
            p=pos.copy(); axis=0 if cmd.upper()=="H" else 1
            p[axis] = vals[0] + (pos[axis] if cmd.islower() else 0)
        if cmd.upper()=="M":
            if ring: raise _Unsupported("Open subpath not supported")
            start=p.copy(); cmd="l" if cmd.islower() else "L"
        elif not ring: raise _Unsupported("Subpath must start with moveto")
        ring.append(p.tolist()); pos=p
    if ring: raise _Unsupported("Only explicitly closed filled paths supported")
    return rings


def _polygon_mask(rings, x, y, rule):
    winding = np.zeros(x.shape, np.int32)
    for ring in rings:
        for a,b in zip(ring, ring[1:]+ring[:1]):
            ax,ay=a; bx,by=b
            cross=(bx-ax)*(y-ay)-(by-ay)*(x-ax)
            winding += ((ay<=y)&(by>y)&(cross>0)).astype(np.int32)
            winding -= ((ay>y)&(by<=y)&(cross<0)).astype(np.int32)
    return winding % 2 != 0 if rule=="evenodd" else winding != 0


def _svg(raw, layers, issues):
    text=raw.decode("utf-8-sig")
    if "\0" in text: raise _Unsupported("Only UTF-8 SVG input supported")
    declaration=re.match(r"\s*<\?xml\s+([^?]*)\?>",text)
    if declaration:
        encoding=re.search(r'''encoding\s*=\s*['"]([^'"]+)['"]''',declaration.group(1))
        if encoding and encoding.group(1).lower() not in ("utf-8","utf8"):
            raise _Unsupported("Only UTF-8 SVG input supported")
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", text, re.I):
        raise _Unsupported("DTD/entities/external stylesheets forbidden")
    root = ET.fromstring(text)
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise _Unsupported("Expected SVG namespace root")
    if "transform" in root.attrib:
        raise _Unsupported("Root viewport transform unsupported; use an explicit group transform")
    for node in root.iter():
        if node.tag.rsplit("}",1)[-1] in ("script","image","use","foreignObject"):
            raise _Unsupported("SVG executable/resource element forbidden")
        if any(key.rsplit("}",1)[-1].lower().startswith("on") or key.rsplit("}",1)[-1]=="href" for key in node.attrib):
            raise _Unsupported("SVG event handlers/resource references forbidden")
    w,h = _dimensions(_num(root.get("width", "0")), _num(root.get("height", "0")))
    if root.get("preserveAspectRatio", "xMidYMid meet") not in ("xMidYMid meet", "none"):
        raise _Unsupported("Unsupported preserveAspectRatio")
    vb = _numbers(root.get("viewBox", f"0 0 {w} {h}"))
    if len(vb)!=4 or min(vb[2:])<=0: raise _Unsupported("Invalid viewBox")
    sx,sy = w/vb[2], h/vb[3]
    if root.get("preserveAspectRatio") != "none": sx=sy=min(sx,sy)
    matrix=np.array([[sx,0,(w-vb[2]*sx)/2-vb[0]*sx],[0,sy,(h-vb[3]*sy)/2-vb[1]*sy],[0,0,1.]])
    yy,xx = np.mgrid[:h,:w]; canvas_points=np.stack([xx+.5, yy+.5, np.ones_like(xx)], axis=0).reshape(3,-1)
    seen=set()
    common={"id","transform","fill","fill-rule","fill-opacity","opacity","display","visibility","style"}
    shape_attrs={"rect":{"x","y","width","height"},"circle":{"cx","cy","r"},"ellipse":{"cx","cy","rx","ry"},"polygon":{"points"},"path":{"d"},"g":set(),"svg":{"width","height","viewBox","preserveAspectRatio","version"}}
    def visit(el,parent,parent_matrix,inherited,shown,ancestors):
        if not el.tag.startswith("{http://www.w3.org/2000/svg}"):
            raise _Unsupported("Foreign XML namespace unsupported")
        tag=el.tag.rsplit("}",1)[-1]
        if tag=="svg" and parent is not None:
            raise _Unsupported("Nested SVG viewport semantics unsupported")
        ident=el.get("id", f"svg-object-{len(seen):04d}")
        if ident in seen: raise _Unsupported("Duplicate SVG object ID")
        seen.add(ident)
        if len(seen)>MAX_LAYERS: raise _Unsupported("SVG object resource limit")
        if len(seen)*w*h>MAX_LAYER_PIXELS: raise _Unsupported("SVG aggregate layer resource limit")
        if tag in ("title","desc","metadata"): return
        if tag not in shape_attrs: raise _Unsupported("Unsupported SVG element: " + tag)
        props=dict(inherited); props.update(el.attrib)
        style=el.get("style", "")
        for decl in style.split(";"):
            if not decl.strip(): continue
            if ":" not in decl: raise _Unsupported("Invalid inline style")
            k,v=decl.split(":",1); k=k.strip(); v=v.strip()
            if k not in {"fill","fill-rule","fill-opacity","opacity","display","visibility"}: raise _Unsupported("Unsupported SVG style: "+k)
            props[k]=v
        for key in el.attrib:
            if key not in common|shape_attrs[tag]: raise _Unsupported("Unsupported SVG attribute: "+key)
        for k,v in props.items():
            if "url(" in str(v).lower() or k.lower().startswith("on"):
                raise _Unsupported("SVG resources/scripts forbidden")
        # opacity is deliberately excluded from inherited properties. Use the
        # parsed declaration, not textual substring matching (XML character
        # references may preserve tabs/newlines around the CSS colon).
        opacity=_num(props.get("opacity","1"))
        fill_opacity=_num(props.get("fill-opacity","1"))
        if not 0<=opacity<=1 or not 0<=fill_opacity<=1: raise _Unsupported("Opacity outside range")
        display=props.get("display","inline"); visibility=props.get("visibility","visible")
        if display not in ("inline","none") or visibility not in ("visible","hidden"): raise _Unsupported("Unsupported display/visibility")
        visible=shown and display!="none" and visibility!="hidden"
        local=_affine(el.get("transform", "")); transform=parent_matrix @ local
        if tag in ("svg","g"):
            if opacity!=1: raise _Unsupported("Group opacity requires isolated group compositing")
            layers.append({"id":ident,"parentId":parent,"order":len(layers),"kind":"GROUP","visible":visible,"opacity":opacity,"transform":transform.tolist(),"rgba":None,"mask":None,"ancestorIds":ancestors})
            inherit={k:props[k] for k in ("fill","fill-opacity","fill-rule","visibility") if k in props}
            for child in el: visit(child,ident,transform,inherit,shown and display!="none",ancestors+[ident])
            return
        if len(el): raise _Unsupported("Shape child elements unsupported")
        fill=props.get("fill","black"); rule=props.get("fill-rule","nonzero")
        if rule not in ("nonzero","evenodd"): raise _Unsupported("Unsupported fill-rule")
        if fill=="none": color=(0,0,0); fill_opacity=0
        else:
            if not re.fullmatch(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?|[A-Za-z]+",fill): raise _Unsupported("Unsupported fill color")
            color=ImageColor.getrgb(fill)
            if len(color)!=3: raise _Unsupported("Unsupported alpha color")
        local_points=np.linalg.inv(transform)@canvas_points
        x,y=local_points[0].reshape(h,w),local_points[1].reshape(h,w)
        if tag=="rect":
            a,b=_num(el.get("x",0)),_num(el.get("y",0)); rw,rh=_num(el.get("width",0)),_num(el.get("height",0))
            if min(rw,rh)<0: raise _Unsupported("Negative rectangle extent")
            mask=(x>=a)&(x<a+rw)&(y>=b)&(y<b+rh)
        elif tag in ("circle","ellipse"):
            a,b=_num(el.get("cx",0)),_num(el.get("cy",0)); rx=_num(el.get("r" if tag=="circle" else "rx",0)); ry=rx if tag=="circle" else _num(el.get("ry",0))
            if min(rx,ry)<=0: raise _Unsupported("Nonpositive ellipse radius")
            mask=((x-a)/rx)**2+((y-b)/ry)**2<1
        else:
            if tag=="path": rings=_paths(el.get("d",""))
            else:
                pts=_numbers(el.get("points",""))
                if len(pts)<6 or len(pts)%2: raise _Unsupported("Invalid polygon")
                rings=[np.array(pts).reshape(-1,2).tolist()]
            mask=_polygon_mask(rings,x,y,rule)
        rgba=np.zeros((h,w,4),np.uint8); rgba[mask,:3]=color; rgba[mask,3]=round(255*opacity*fill_opacity)
        if not visible: rgba[:]=0
        layers.append({"id":ident,"parentId":parent,"order":len(layers),"kind":"PIXEL_OBJECT","visible":visible,"opacity":opacity,"fillOpacity":fill_opacity,"transform":transform.tolist(),"sourceTransform":el.get("transform", ""),"rgba":rgba,"mask":rgba[:,:,3]>0,"ancestorIds":ancestors,"fillRule":rule})
    visit(root,None,matrix,{},True,[])
    return w,h,{"viewBox":vb,"normalization":"inverse affine pixel-center fill, no antialiasing","sourceToAnalysis":matrix.tolist()}


class _Reader:
    def __init__(self, data): self.data=data; self.pos=0
    def take(self,n):
        if n<0 or self.pos+n>len(self.data): raise _Unsupported("Truncated PSD structure")
        b=self.data[self.pos:self.pos+n]; self.pos+=n; return b
    def unpack(self,fmt): return struct.unpack(">"+fmt,self.take(struct.calcsize(">"+fmt)))
    def u32(self): return self.unpack("I")[0]
    def block(self): return self.take(self.u32())


def _channel(raw,w,h):
    r=_Reader(raw); compression=r.unpack("H")[0]
    if compression==0: payload=r.take(w*h)
    elif compression==1:
        sizes=r.unpack("H"*h); rows=[]
        for size in sizes:
            row=_Reader(r.take(size)); out=bytearray()
            while row.pos<len(row.data):
                n=row.unpack("b")[0]
                if 0<=n<=127: out.extend(row.take(n+1))
                elif -127<=n<=-1: out.extend(row.take(1)*(1-n))
                if len(out)>w: raise _Unsupported("Invalid PSD RLE row")
            if len(out)!=w: raise _Unsupported("Invalid PSD RLE length")
            rows.append(bytes(out))
        payload=b"".join(rows)
    else: raise _Unsupported("Unsupported PSD channel compression")
    if r.pos!=len(raw): raise _Unsupported("Excess PSD channel bytes")
    return np.frombuffer(payload,np.uint8).reshape(h,w)


def _psd(raw,layers,issues):
    r=_Reader(raw)
    if r.take(4)!=b"8BPS" or r.unpack("H")[0]!=1: raise _Unsupported("Not PSD v1")
    if r.take(6)!=b"\0"*6: raise _Unsupported("Invalid PSD reserved header")
    channels,h,w,depth,mode=r.unpack("HIIHH"); w,h=_dimensions(w,h)
    if depth!=8 or mode!=3 or channels not in (3,4): raise _Unsupported("Only PSD 8-bit RGB supported")
    if r.block(): raise _Unsupported("Unexpected RGB color-mode data")
    resources=_Reader(r.block())
    # Metadata may carry appearance/color-management instructions; no silent omission.
    if resources.data: raise _Unsupported("PSD image resources unsupported (including color profiles)")
    lm=_Reader(r.block()); info=_Reader(lm.block())
    count=abs(info.unpack("h")[0])
    if not 1<=count<=MAX_LAYERS: raise _Unsupported("PSD needs actual bounded layer records")
    if count*w*h>MAX_LAYER_PIXELS: raise _Unsupported("PSD aggregate canvas resource limit")
    records=[]
    native_pixels=0
    for index in range(count):
        top,left,bottom,right=info.unpack("iiii"); lw,lh=right-left,bottom-top
        if min(lw,lh)<=0 or lw*lh>MAX_PIXELS: raise _Unsupported("Unsupported PSD layer dimensions")
        native_pixels+=lw*lh
        if native_pixels>MAX_LAYER_PIXELS: raise _Unsupported("PSD aggregate native resource limit")
        n=info.unpack("H")[0]
        if n not in (3,4): raise _Unsupported("Only ordinary RGB(A) layer channels supported")
        channel_info=[info.unpack("hI") for _ in range(n)]
        if len({c[0] for c in channel_info})!=n or not {0,1,2}.issubset({c[0] for c in channel_info}) or any(c[0] not in (-1,0,1,2) for c in channel_info): raise _Unsupported("PSD masks/extra channels unsupported")
        if info.take(4)!=b"8BIM": raise _Unsupported("Invalid PSD blend signature")
        blend=info.take(4); opacity,clipping,flags,filler=info.unpack("BBBB")
        extra=_Reader(info.block())
        if extra.block(): issues.append("PSD layer mask unsupported")
        ranges=extra.block()
        if ranges and ranges!=b"\0\0\xff\xff"*(len(ranges)//4): issues.append("PSD blending ranges unsupported")
        name_size=extra.unpack("B")[0]; name=extra.take(name_size).decode("mac_roman"); extra.take((-(name_size+1))%4)
        ident=f"psd-layer-{index:04d}"
        while extra.pos<len(extra.data):
            if extra.take(4)!=b"8BIM": raise _Unsupported("Invalid PSD additional layer block")
            key=extra.take(4); length=extra.u32(); data=extra.take(length); extra.take(length%2)
            if key==b"lyid" and length==4: ident="psd-layer-id-"+str(struct.unpack(">I",data)[0])
            elif key==b"luni":
                nr=_Reader(data); name=nr.take(nr.u32()*2).decode("utf-16-be")
            else: issues.append("Unsupported PSD layer feature: "+key.decode("ascii",errors="replace"))
        if blend!=b"norm" or clipping or flags&16 or filler: issues.append("PSD special blend/clipping/irrelevant pixel flag unsupported")
        records.append((index,ident,name,top,left,lw,lh,channel_info,opacity,not bool(flags&2)))
    seen=set()
    for index,ident,name,top,left,lw,lh,channel_info,opacity,visible in records:
        if ident in seen: raise _Unsupported("Duplicate PSD layer ID")
        seen.add(ident); pixel=np.zeros((lh,lw,4),np.uint8); pixel[:,:,3]=255
        for cid,length in channel_info: pixel[:,:,3 if cid==-1 else cid]=_channel(info.take(length),lw,lh)
        pixel[:,:,3]=np.rint(pixel[:,:,3].astype(float)*opacity/255).astype(np.uint8)
        rgba=np.zeros((h,w,4),np.uint8); x0,y0=max(left,0),max(top,0); x1,y1=min(left+lw,w),min(top+lh,h)
        if visible and x1>x0 and y1>y0: rgba[y0:y1,x0:x1]=pixel[y0-top:y1-top,x0-left:x1-left]
        layers.append({"id":ident,"name":name,"parentId":None,"order":count-1-index,"sourceRecordIndex":index,"kind":"PIXEL_OBJECT","visible":visible,"opacity":opacity/255,"transform":[[1,0,left],[0,1,top],[0,0,1]],"sourceBounds":[left,top,lw,lh],"rgba":rgba,"mask":rgba[:,:,3]>0,"ancestorIds":[]})
    if any(info.take(len(info.data)-info.pos)): raise _Unsupported("Unparsed PSD layer data")
    if lm.pos<len(lm.data) and lm.block(): issues.append("PSD global layer mask unsupported")
    if any(lm.take(len(lm.data)-lm.pos)): issues.append("PSD global tagged data unsupported")
    # Merged data is required by PSD file format but is never used as layer evidence.
    compression=r.unpack("H")[0]
    if compression==0: r.take(w*h*channels)
    elif compression==1:
        sizes=r.unpack("H"*(h*channels)); r.take(sum(sizes))
    else: raise _Unsupported("Unsupported PSD merged compression")
    if r.pos!=len(raw): raise _Unsupported("PSD trailing bytes")
    layers.sort(key=lambda layer:layer["order"])
    return w,h,{"normalization":"ordinary PSD pixel channels; integer canvas translation; straight-alpha source-over","sourceToAnalysis":np.eye(3).tolist()}


def _composite(layers,w,h):
    out=np.zeros((h,w,4),float)
    for layer in layers:
        src=layer["rgba"].astype(float)/255; a=src[:,:,3:4]; oa=out[:,:,3:4]
        alpha=a+oa*(1-a)
        out[:,:,:3]=np.divide(src[:,:,:3]*a+out[:,:,:3]*oa*(1-a),alpha,out=np.zeros_like(out[:,:,:3]),where=alpha>0)
        out[:,:,3:4]=alpha
    return np.rint(out*255).astype(np.uint8)


def parse_layered(path: Path, selected_ids: list[str] | None) -> dict:
    """Read only path bytes, normalize an explicitly selected supported layer subset.

    PARTIAL never supplies a render to downstream fabrication. No selection means
    evidence can be inspected but source semantics are UNRESOLVED (rgba=None).
    """
    path=Path(path)
    if path.stat().st_size>MAX_BYTES: raise ValueError("Layered source exceeds byte limit")
    raw=path.read_bytes(); layers=[]; issues=[]
    if len(raw)>MAX_BYTES: raise ValueError("Layered source exceeds byte limit")
    media_type={".svg":"image/svg+xml",".psd":"image/vnd.adobe.photoshop"}.get(path.suffix.lower(),"application/octet-stream")
    result={"adapterId":"m5-finite-layered/1","status":"UNSUPPORTED","rgba":None,"layers":layers,"sourceBytes":raw,"sourceMediaType":media_type,"sourceSha256":hashlib.sha256(raw).hexdigest(),"sourceByteLength":len(raw),"unsupportedFeatures":issues,"provenance":{"sourceKind":"LAYERED","mediaType":media_type,"selectionRule":"EXPLICIT_IDS_ONLY","selectedIds":selected_ids,"sampleConvention":"PIXEL_CENTER"}}
    try:
        if path.suffix.lower()==".svg": w,h,details=_svg(raw,layers,issues)
        elif path.suffix.lower()==".psd": w,h,details=_psd(raw,layers,issues)
        else: raise _Unsupported("Unsupported layered file format")
        result.update(width=w,height=h); result["provenance"].update(details)
        m=details["sourceToAnalysis"]
        result["sourceFrame"]={"bounds":details.get("viewBox",[0,0,w,h]),"matrixToAnalysis":[m[0][0],m[1][0],m[0][1],m[1][1],m[0][2],m[1][2]],"unit":"native-unit","sampleConvention":"CONTINUOUS" if path.suffix.lower()==".svg" else "PIXEL_CELL_BOUNDARY"}
        if issues: result["status"]="PARTIAL"; return result
        result["status"]="SUPPORTED"
        if not selected_ids:
            result["selectionStatus"]="UNRESOLVED"; return result
        ids={layer["id"] for layer in layers}
        if selected_ids != ["*"] and ("*" in selected_ids or set(selected_ids)-ids): raise _Unsupported("Unknown or mixed wildcard selected IDs")
        selected=[layer for layer in layers if layer["rgba"] is not None and (selected_ids==["*"] or layer["id"] in selected_ids or set(layer["ancestorIds"])&set(selected_ids))]
        if not selected: raise _Unsupported("Selection contains no supported pixel objects")
        result["selectionStatus"]="EXPLICIT"; result["selectedLayerIds"]=[layer["id"] for layer in selected]
        result["rgba"]=_composite(selected,w,h)
        # A unique opaque owner is evidence; blended pixels retain owner=-1.
        owner=np.full((h,w),-1,np.int32)
        for i,layer in enumerate(selected):
            alpha=layer["rgba"][:,:,3]; owner[alpha>0]=-1
            if layer.get("opacity",1)==1 and layer.get("fillOpacity",1)==1:
                owner[alpha==255]=i
        result["opaqueOwnerIndex"]=owner
        for i,layer in enumerate(selected): layer["opaqueVisibleMask"]=(owner==i)
        result["normalizedSha256"]=hashlib.sha256(result["rgba"].tobytes()).hexdigest()
    except (ValueError, ET.ParseError, struct.error, OverflowError, np.linalg.LinAlgError) as error:
        issues.append(str(error)); result["status"]="PARTIAL" if layers else "UNSUPPORTED"; result["rgba"]=None
    return result
