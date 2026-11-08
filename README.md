# Facet for Omarchy

Facet for Omarchy Linux. This is a native rebuild of the macOS browser's feature set on Chromium, made from the macOS release because the Swift app depends on Apple-only frameworks.

## Features

| Area | What you get |
| --- | --- |
| Tabs | Vertical tab sidebar with filter |
| Reading | Reader mode, persistent highlights, copy as Markdown, quote links |
| Privacy | uBlock Origin Lite, tracking-parameter removal |
| Comfort | Dark mode for sites, calm mode, hover link peek |
| Video | Playback controls, picture in picture, SponsorBlock |
| AI | Local chat and page summaries through Ollama |
| Speech | Local live captions with faster-whisper |
| Translation | Local page and selection translation with Argos Translate |

## Install

Requires Chromium, [uv](https://docs.astral.sh/uv/), and optionally Ollama.

```sh
./install.sh
facet
```

The AI panel uses your local Ollama at `127.0.0.1:11434` with no service changes.

## Architecture

- `extension/` is the Manifest V3 browser layer: sidebar, page tools and AI panel.
- `native/` is a Chrome native messaging host for speech and translation. It accepts a fixed list of actions from this extension only.
- `bin/facet` launches Chromium with a dedicated profile.

Speech and translation run on your machine. Whisper and Argos models download on first use.

## License

Project code is private and all rights are reserved. `vendor/ubol` is uBlock Origin Lite, licensed under GPLv3; see `vendor/ubol/LICENSE-uBOLite.txt`.
