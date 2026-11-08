# Facet for Omarchy

Facet for Omarchy Linux. It rebuilds the feature set of the macOS Facet browser for Linux. The native app is the primary build. A Chromium build with the same page tools remains as a fallback.

## Native app (primary)

A GTK4 and libadwaita window around WebKitGTK, written in Rust (`app/`).

| Area | What you get |
| --- | --- |
| Tabs | Vertical tab sidebar, Spaces with their own tab lists and tints, favorites, session restore |
| Command palette | `Ctrl+K` and `Ctrl+T`: open tabs, history, commands, search or address |
| Page tools | Reader mode, persistent highlights, copy as Markdown, clean and Markdown links, dark and calm mode per site, picture in picture, SponsorBlock |
| Context menu | The page tools above on right click, with the link under the pointer for the link actions |
| Link peek | Hover preview with title, description and image. The fetch runs in the app, refuses private addresses and is limited to 6 seconds and 200 KB |
| Translate Page | Palette command that translates page text on your machine with Argos Translate |
| Themes | Eight themes shown through the sidebar and start page, `Ctrl+Shift+T` for the next one |
| Ask Facet | `Ctrl+J`: streaming answers from a local Ollama model, no account |
| Settings | `Ctrl+,`: search engine, sidebar side, ad blocking, first-run onboarding, a downloads list and Tidy for tabs |
| History | Visits are kept in `history.json` in the app data directory (5000 newest) and searched from the palette |
| Privacy | Ad and tracker blocking from compiled uBlock Origin Lite rulesets, tracking-parameter removal |

### Install

Requires Rust, GTK4, libadwaita, WebKitGTK 6 and Python 3 (for the rules build).

```sh
./scripts/install-native.sh
facet
```

This builds the app, installs it as `~/.local/bin/facet`, and installs the compiled blocking rules. Translate Page also needs the local runtime that `./install.sh` sets up (see below).

### Limits

- No DRM. WebKitGTK ships without Widevine, so services that require it (most paid video streaming) will not play.
- No browser extensions. The page tools are built in and share their scripts with the Chromium build.
- Apple-only features have an equivalent or are absent. Absent: Handoff, iCloud Keychain and passkey sync, Touch ID, AirPlay, Siri. Equivalents: local Argos translation in place of Apple's translation, and a local history file in place of synced history.
- Read aloud needs speech-dispatcher, which is not installed here, so the command is not offered.
- Not ported yet: live captions, Rewind, Panic key, Secret Favorites and Space lock, voice Talk, agents, a password manager, Tor, bookmark import and GitHub actions.
- Ask Facet needs a local Ollama server with at least one model. It uses the first model Ollama lists.
- Link peek checks the host's addresses before each request. A DNS answer that changes between that check and the connection is not covered.
- Translate Page translates the first 20,000 characters of visible text. The first run for a language pair downloads a model, which can take a minute.

## Chromium build (fallback)

Use this when a site needs something WebKit lacks. It has the full set of features from the first release.

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

Requires Chromium, [uv](https://docs.astral.sh/uv/), and optionally Ollama.

```sh
./install.sh
bin/facet
```

`./install.sh` also links `~/.local/bin/facet` to the Chromium launcher, so run `./scripts/install-native.sh` last if you want `facet` to open the native app. The Chromium build is always available as `bin/facet`.

The AI panel uses your local Ollama at `127.0.0.1:11434` with no service changes.

## Architecture

- `app/` is the native app: `src/main.rs` (window, Spaces, palette, history, link peek, translation), `src/page-shim.js` (the small part of the extension API the page scripts use, backed by a script-message bridge), `src/translate.js`, and `src/style.css`.
- `extension/` is the Manifest V3 browser layer for Chromium. Its `extension/page/` scripts are shared with the native app.
- `native/` is a native messaging host for speech and translation. It accepts a fixed list of actions. The native app starts it for Translate Page and speaks the same framing as Chromium.
- `bin/facet` launches Chromium with a dedicated profile.

Speech and translation run on your machine. Whisper and Argos models download on first use.

## License

Project code is private and all rights are reserved. `vendor/ubol` is uBlock Origin Lite, licensed under GPLv3; see `vendor/ubol/LICENSE-uBOLite.txt`.
