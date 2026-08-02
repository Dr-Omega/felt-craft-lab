# Generated fixture media

These files under `assets/generated/**` are **project-authored test fixtures** for the
`felt-resource:` resolver. They are not licensed third-party media and are not
production content from YWN (except when YWN later replaces audio snapshots).

| File | Purpose | Origin / license |
| --- | --- | --- |
| `material/mock-sticker.png` | Minimal 8×8 PNG for material image smoke | Generated in-repo for tests; no third-party rights |
| `material/mock-background.png` | Minimal 8×8 PNG for background mock | Generated in-repo for tests; no third-party rights |
| `audio/mock-name-zh.wav` | Short silent WAV for resource / AudioService smoke | Generated in-repo for tests; no third-party rights |
| `audio/audio-index.json` | Index of **YWN-approved** fixed intros only | Batch tool / empty until approved |

Team demo intro MP3s (`rabbit_intro`, `flower_intro`) live under `assets/demo/audio/` and
are **not** packaged via `extraResources`.

Project previews are not stored in the repository. Runtime writes go to
Electron `userData/previews` and are referenced as `felt-resource://preview/...`.

Dynamic TTS audio is written by Main to `userData/audio/dynamic/<hash>.mp3` and
referenced as `felt-resource://audio/dynamic/<hash>.mp3` (not under this tree).
