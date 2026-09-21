import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from layered_sources import parse_layered
from generate_layered_examples import development_psd, development_svg


class LayeredEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def read(self,data,suffix="svg",selection=None):
        path=self.root/("source."+suffix); path.write_bytes(data)
        return parse_layered(path,["*"] if selection is None else selection)

    def test_actual_svg_and_psd_layer_channels_match_known_composition(self):
        svg=self.read(development_svg()); psd=self.read(development_psd(),"psd")
        self.assertEqual(svg["status"],"SUPPORTED"); self.assertEqual(psd["status"],"SUPPORTED")
        np.testing.assert_array_equal(svg["rgba"],psd["rgba"])
        self.assertEqual(svg["rgba"][15,20].tolist(),[32,80,208,255])
        self.assertEqual(svg["rgba"][6,6].tolist(),[208,48,48,255])
        self.assertEqual(svg["rgba"][0,0].tolist(),[0,0,0,0])
        self.assertEqual(len([x for x in psd["layers"] if x["rgba"] is not None]),2)
        # Independently read the genuine PSD merged preview with Pillow.
        with Image.open(self.root/"source.psd") as preview:
            self.assertEqual(preview.format,"PSD")
            self.assertEqual(preview.convert("RGB").getpixel((20,15)),(32,80,208))
        back,front=psd["layers"]
        self.assertGreater(np.count_nonzero(back["mask"] & front["mask"]),0)
        self.assertTrue(back["opaqueVisibleMask"].any()); self.assertTrue(front["opaqueVisibleMask"].any())

    def test_psd_rle_decodes_actual_separate_layers(self):
        raw=self.read(development_psd(),"psd"); compressed=self.read(development_psd(compressed=True),"psd")
        self.assertEqual(compressed["status"],"SUPPORTED")
        np.testing.assert_array_equal(raw["rgba"],compressed["rgba"])

    def test_source_identity_and_explicit_selection(self):
        path=self.root/"a.svg"; raw=development_svg(); path.write_bytes(raw)
        unset=parse_layered(path,None)
        self.assertEqual(unset["status"],"SUPPORTED"); self.assertIsNone(unset["rgba"])
        self.assertEqual(unset["selectionStatus"],"UNRESOLVED")
        selected=parse_layered(path,["red-back"])
        self.assertEqual(selected["sourceSha256"],hashlib.sha256(raw).hexdigest())
        self.assertEqual(selected["selectedLayerIds"],["red-back"])
        self.assertEqual(selected["rgba"][15,20].tolist(),[208,48,48,255])
        group=parse_layered(path,["explicit-foreground"])
        self.assertEqual(group["selectedLayerIds"],["red-back","blue-front"])
        self.assertIsNone(parse_layered(path,["absent"])["rgba"])

    def test_groups_transform_fill_rules_and_viewbox(self):
        raw=b'''<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 12 12"><g id="g" transform="translate(1 1)"><path id="ring" fill="#ff0000" fill-rule="evenodd" d="M0 0H10V10H0Z M3 3H7V7H3Z"/></g></svg>'''
        result=self.read(raw)
        self.assertEqual(result["status"],"SUPPORTED")
        self.assertEqual(result["rgba"][3,3,3],255); self.assertEqual(result["rgba"][12,12,3],0)
        ring=result["layers"][-1]; self.assertEqual(ring["parentId"],"g")
        self.assertEqual(ring["transform"],[[2,0,2],[0,2,2],[0,0,1]])
        nonzero=self.read(raw.replace(b'evenodd',b'nonzero'))
        self.assertEqual(nonzero["rgba"][12,12,3],255)

    def test_ellipse_polygon_rotation_and_opacity(self):
        raw=b'''<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><ellipse id="ellipse" cx="6" cy="6" rx="5" ry="4" fill="red"/><polygon id="triangle" transform="rotate(90 6 6)" points="2,2 10,2 6,10" fill="blue" opacity="0.5"/></svg>'''
        result=self.read(raw)
        self.assertEqual(result["status"],"SUPPORTED")
        self.assertEqual(result["rgba"][6,6].tolist(),[127,0,128,255])
        self.assertEqual(result["opaqueOwnerIndex"][6,6],-1)

    def test_hidden_svg_and_psd_preserve_metadata_but_not_render(self):
        svg=self.read(development_svg().replace(b'id="blue-front"',b'id="blue-front" visibility="hidden"'))
        self.assertFalse(svg["layers"][-1]["visible"])
        self.assertEqual(svg["rgba"][15,20].tolist(),[208,48,48,255])
        raw=development_psd().replace(b'8BIMnorm\xff\0\0\0',b'8BIMnorm\xff\0\x02\0',1)
        psd=self.read(raw,"psd")
        self.assertEqual(psd["status"],"SUPPORTED")
        self.assertFalse(psd["layers"][-1]["visible"])
        self.assertEqual(psd["rgba"][15,20].tolist(),[208,48,48,255])

    def test_unsupported_svg_features_fail_closed(self):
        for attribute in (b'filter="url(#blur)"',b'stroke="black"',b'clip-path="url(#clip)"'):
            with self.subTest(attribute=attribute):
                result=self.read(development_svg().replace(b'id="blue-front"',b'id="blue-front" '+attribute))
                self.assertIn(result["status"],("PARTIAL","UNSUPPORTED")); self.assertIsNone(result["rgba"])
                self.assertTrue(result["unsupportedFeatures"])
        result=self.read(development_svg().replace(b'translate(4 4)',b'translate(4 4)" opacity="0.5'))
        self.assertIsNone(result["rgba"])
        curves=self.read(development_svg().replace(b'M 14 8 L 38 8',b'M 14 8 C 10 10 20 20 38 8'))
        self.assertIsNone(curves["rgba"])

    def test_svg_does_not_execute_script_or_fetch_resources(self):
        for payload in (b'<script>throw new Error()</script>',b'<image href="file:///secret.png"/>',b'<use href="https://example.com/file.svg#x"/>'):
            raw=development_svg().replace(b'</svg>',payload+b'</svg>')
            with patch("urllib.request.urlopen",side_effect=AssertionError("network accessed")),patch("builtins.open",side_effect=AssertionError("external file accessed")):
                result=self.read(raw)
            self.assertIsNone(result["rgba"]); self.assertTrue(result["unsupportedFeatures"])
        entity=b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]>'+development_svg()
        self.assertEqual(self.read(entity)["status"],"UNSUPPORTED")
        self.assertEqual(self.read(entity.decode().encode("utf-16"))["status"],"UNSUPPORTED")

    def test_psd_special_blend_and_malformed_files_rejected(self):
        result=self.read(development_psd(blend=b"mul "),"psd")
        self.assertEqual(result["status"],"PARTIAL"); self.assertIsNone(result["rgba"])
        self.assertEqual(len(result["layers"]),2)
        for raw in (b'\x89PNG\r\n\x1a\n',development_psd()[:160],development_psd().replace(b'8BPS\0\x01',b'8BPS\0\x02',1)):
            self.assertIsNone(self.read(raw,"psd")["rgba"])

    def test_psd_groups_smart_objects_adjustments_explicitly_unsupported(self):
        for key in (b"lsct",b"SoLd",b"brit",b"lrFX"):
            result=self.read(development_psd(feature_key=key),"psd")
            self.assertEqual(result["status"],"PARTIAL"); self.assertIsNone(result["rgba"])
            self.assertTrue(any(key.decode() in issue for issue in result["unsupportedFeatures"]))

    def test_visibility_override_and_display_none_have_distinct_semantics(self):
        raw=development_svg().replace(b'id="explicit-foreground"',b'id="explicit-foreground" visibility="hidden"').replace(b'id="blue-front"',b'id="blue-front" visibility="visible"')
        result=self.read(raw)
        self.assertEqual(result["status"],"SUPPORTED")
        self.assertEqual(result["rgba"][6,6,3],0)
        self.assertEqual(result["rgba"][15,20,3],255)
        hidden=self.read(raw.replace(b'visibility="hidden"',b'display="none"'))
        self.assertEqual(np.count_nonzero(hidden["rgba"][:,:,3]),0)

    def test_style_whitespace_cannot_bypass_opacity_semantics(self):
        raw=development_svg().replace(b'id="blue-front"',b'id="blue-front" style="opacity &#9;: 0.5"')
        result=self.read(raw)
        self.assertEqual(result["status"],"SUPPORTED")
        self.assertEqual(result["layers"][-1]["opacity"],0.5)
        self.assertEqual(result["layers"][-1]["rgba"][15,20,3],128)
        group=development_svg().replace(b'id="explicit-foreground"',b'id="explicit-foreground" style="opacity &#9;: 0.5"')
        self.assertIsNone(self.read(group)["rgba"])

    def test_nested_viewport_and_root_transform_are_explicitly_unsupported(self):
        nested=b'''<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><svg width="10" height="10" viewBox="0 0 20 20"><rect width="20" height="20"/></svg></svg>'''
        self.assertIsNone(self.read(nested)["rgba"])
        root_transform=development_svg().replace(b'viewBox="0 0 48 40"',b'viewBox="0 0 48 40" transform="translate(2 3)"')
        self.assertIsNone(self.read(root_transform)["rgba"])

    def test_duplicate_ids_unknown_selection_and_singular_transform(self):
        for raw in (development_svg().replace(b'blue-front',b'red-back'),development_svg().replace(b'translate(4 4)',b'scale(0)')):
            self.assertIsNone(self.read(raw)["rgba"])
        self.assertIsNone(self.read(development_svg(),selection=["*","red-back"])["rgba"])


if __name__=="__main__": unittest.main()
