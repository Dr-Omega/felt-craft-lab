# Generated fixture / snapshot media

| File / tree | Purpose | Origin / license |
| --- | --- | --- |
| `material/mock-sticker.png` | Minimal mock PNG for resolver smoke | In-repo test fixture |
| `material/mock-background.png` | Minimal mock PNG for background smoke | In-repo test fixture |
| `material/*.png` (YWN ready) | Formal material/thumbnail snapshot from YWN pack | YWN content; see Manifest `source`/`license` |
| `audio/mock-name-zh.wav` | Short silent WAV for AudioService smoke | In-repo test fixture |
| `audio/*.mp3` (YWN ready) | Fixed name/intro TTS snapshot | YWN-approved MiniMax batch |
| `assets.manifest.json` | Program Asset Manifest (`AssetRecord[]` + snapshot) | Built by `scripts/build-ywn-manifest.py` |
| `validation-report.json` | Last import report | SXY build output |
| `audio/audio-index.json` | Index of YWN-approved fixed intros | Batch tool |

Project previews are not stored in the repository. Runtime writes go to
Electron `userData/previews` and are referenced as `felt-resource://preview/...`.

Dynamic TTS audio is written by Main to `userData/audio/dynamic/<hash>.mp3` and
referenced as `felt-resource://audio/dynamic/<hash>.mp3` (not under this tree).
