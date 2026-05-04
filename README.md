# hermes-fonts-colors

A small dashboard plugin for [Hermes](https://github.com/NousResearch/hermes-agent) that adds a **Styling** tab where you can change the dashboard's heading font, body font, code font, sizes, and colors — without touching theme YAML or rebuilding the frontend.

The plugin layers on top of whatever Hermes theme you have active, so you can keep your favorite color scheme and still pick a more readable typeface.

## Why

The default Hermes dashboard font stack (system-ui sans + SF Mono / Menlo) is dense and can be hard to read on some monitors. This plugin gives every Hermes user a one-click way to switch to readable fonts like **DM Sans** and **JetBrains Mono**, adjust sizes, and tune text colors — all from the dashboard itself.

## Features

- **Curated font list** — DM Sans, Inter, IBM Plex Sans, Atkinson Hyperlegible, System UI for body/heading; JetBrains Mono, Fira Code, IBM Plex Mono, System Mono for code; DM Serif Display and Space Grotesk for display headings.
- **Single Google Fonts request** loads everything you need — no per-font flicker.
- **Live preview** — every adjustment shows up across the entire dashboard immediately, not just in a preview box.
- **Save / Reset / Toggle** — toggle the plugin off to revert to your active theme's defaults without uninstalling.
- **No build step** — the bundle is hand-rolled JS so you can fork and edit `dashboard/dist/index.js` with any text editor.

## Install

```bash
git clone https://github.com/rubengarciajr/hermes-fonts-colors ~/.hermes/plugins/hermes-fonts-colors
```

Then either restart your Hermes dashboard, or trigger a plugin rescan without restarting:

```bash
curl -X POST http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Open `http://127.0.0.1:9119/styling` (or click **Styling** in the sidebar) to use it.

## Uninstall

```bash
rm -rf ~/.hermes/plugins/hermes-fonts-colors
curl -X POST http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

## How it works

When the Hermes dashboard loads, it scans `~/.hermes/plugins/*/dashboard/manifest.json` and dynamically loads each plugin's bundle. This plugin's bundle (`dashboard/dist/index.js`) does two things:

1. **Globally** injects a `<link>` tag for Google Fonts and a `<style>` tag with CSS-variable overrides for `--theme-font-sans`, `--theme-font-display`, `--theme-font-mono`, `--theme-base-size`, `--color-foreground`, etc. — the same vars the built-in Hermes theme system uses, so we don't fight the theme system, we use its public contract.
2. **Registers a React component** for the `/styling` route via `window.__HERMES_PLUGINS__.register(...)`. The component is the settings page.

Settings persist in `~/.hermes/plugins/hermes-fonts-colors/state.json`. The backend (`dashboard/plugin_api.py`) is a tiny FastAPI router mounted at `/api/plugins/hermes-fonts-colors/`.

## API

| Method | Path                                            | Description                                      |
| ------ | ----------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/plugins/hermes-fonts-colors/settings`     | Current saved settings (or defaults).            |
| GET    | `/api/plugins/hermes-fonts-colors/options`      | Allowlists + ranges so the UI can render pickers.|
| PUT    | `/api/plugins/hermes-fonts-colors/settings`     | Validate + persist new settings.                 |
| POST   | `/api/plugins/hermes-fonts-colors/reset`        | Delete `state.json`, return defaults.            |

## Development

The frontend bundle is a single hand-written IIFE — no build step, no package.json, no toolchain. Edit `dashboard/dist/index.js` directly, save, and refresh the dashboard. The plugin SDK exposed at `window.__HERMES_PLUGIN_SDK__` provides React, hooks, and shadcn-style UI components (Card, Button, Input, Label, Select, Badge, …).

To add a font:
1. Add it to `FONT_STACKS` in `dashboard/dist/index.js`.
2. Add it to the matching `*_OPTIONS` array.
3. Add it to the `family=` query in `GOOGLE_FONTS_URL`.
4. Add it to the matching allowlist set in `dashboard/plugin_api.py`.

## Compatibility

Tested against the bundled Hermes dashboard (port 9119). The plugin uses the public `--theme-*` and `--color-*` CSS variables from the Hermes theme system, so it should work with any built-in or user theme. If a future Hermes version renames those vars, this plugin will need a corresponding update.

## License

MIT — see [LICENSE](LICENSE).
