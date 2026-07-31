# Generated fixture media

These files under `assets/generated/**` are **project-authored test fixtures** for the
`felt-resource:` resolver. They are not licensed third-party media and are not
production content from YWN.

| File | Purpose | Origin / license |
| --- | --- | --- |
| `material/mock-sticker.png` | Minimal 8×8 PNG for material image smoke | Generated in-repo for tests; no third-party rights |
| `material/mock-background.png` | Minimal 8×8 PNG for background mock | Generated in-repo for tests; no third-party rights |
| `audio/mock-name-zh.wav` | Short silent WAV for fixed-audio smoke | Generated in-repo for tests; no third-party rights |

Project previews are not stored in the repository. Runtime writes go to
Electron `userData/previews` and are referenced as `felt-resource://preview/...`.
