# Facet for Omarchy

A private, keyboard-first Chromium browser setup for [Omarchy](https://omarchy.org/) Linux. It is an independent reimplementation of the feature set of the macOS browser Facet and is not affiliated with or endorsed by its makers. It contains none of Facet's code or artwork.

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

For the AI panel, start Ollama with `OLLAMA_ORIGINS=chrome-extension://*`.

## Architecture

- `extension/` is the Manifest V3 browser layer: sidebar, page tools and AI panel.
- `native/` is a Chrome native messaging host for speech and translation. It accepts a fixed list of actions from this extension only.
- `bin/facet` launches Chromium with a dedicated profile.

Speech and translation run on your machine. Whisper and Argos models download on first use.

## License

Project code is private and all rights are reserved. `vendor/ubol` is uBlock Origin Lite, licensed under GPLv3; see `vendor/ubol/LICENSE-uBOLite.txt`.
