# pi-clean-tool-render

A compact tool-rendering extension for [Pi](https://github.com/earendil-works/pi-mono) (the pi-coding-agent TUI). It overrides the rendering of `bash`, `edit` and `write` so tool output stays out of your way: collapsed into a tiny summary by default, expanded on demand per tool.

[中文版](README.zh-CN.md)

## Features

- **Collapsed by default** — each tool shows a short summary (at most 3 lines) with an ellipsis for omitted content.
- **Per-tool expansion** — expand exactly the tool you care about, with one shortcut each:

  | Shortcut | Tool |
  |---|---|
  | `Ctrl+Alt+E` | `edit` |
  | `Ctrl+Alt+W` | `write` |
  | `Ctrl+Alt+B` | `bash` |

- **Independent of the global `Ctrl+O`** — Pi's built-in "expand everything" toggle does not affect these three tools. Each tool has exactly two states: collapsed summary ↔ full official rendering.
- **Official renderers on expansion** — expanded views delegate to Pi's built-in renderers, so the full diff preview and syntax highlighting still work.
- **Fast** — rendering caches wrapped output and only processes the preview lines: roughly 13µs per frame for a 2000-line output, instead of ~3ms before.

## Usage

Load the extension:

```bash
pi -e ./minimal-mode.ts
```

Or copy `minimal-mode.ts` into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project) and restart Pi.

Then toggle each tool with `Ctrl+Alt+E` / `Ctrl+Alt+W` / `Ctrl+Alt+B`. A notification shows the current state; press again to collapse.

## Keyboard protocol notes

Pi negotiates the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) (CSI-u sequences) when the terminal supports it — Windows Terminal, WezTerm, Kitty, Ghostty and others do. Under that protocol, `Ctrl+Alt+letter` is encoded with the **control-character codepoint**: `Ctrl+Alt+E` arrives as `\x1b[5;3:1u` (5 = Ctrl+E, modifier = Alt). Pi's keybinding layer, however, recognizes the ASCII-codepoint form (`\x1b[101;7u`, ASCII `e` + Ctrl|Alt modifier). If the terminal sends the former and Pi only understands the latter, the shortcut silently does nothing.

This extension ships a small input bridge: it rewrites the three shortcuts' sequences into the form Pi understands **before** they reach the keybinding layer, no matter which encoding your terminal sends:

- Kitty control-char form (`\x1b[5;3:1u`)
- Legacy form (`ESC` + control char, e.g. `\x1b\x05`)
- ASCII-codepoint form (`\x1b[101;7u`)

All other input passes through untouched.

If a shortcut still does nothing on your machine, check:

1. **Terminal or input method swallows the key.** Some terminals and IMEs (e.g. Chinese input methods, Windows Alt-menu accelerators) intercept `Ctrl+Alt+...` before Pi ever sees it. Try a different combination or a different terminal.
2. **tmux / screen.** If Pi runs inside tmux with the default configuration, tmux's own key handling may interfere.
3. **Custom keys.** The bindings are registered in `minimal-mode.ts` via `pi.registerShortcut(...)` — edit the key strings there to rebind. Pi's built-in global expansion (`Ctrl+O`, `app.tools.expand`) is configured separately via `~/.pi/agent/keybindings.json`.

## Development

```bash
# Type-check (needs @earendil-works/pi-tui resolvable; it ships inside Pi's global install)
tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck minimal-mode.ts

# Smoke test: renders collapsed/expanded states with a fake extension host, and
# benchmarks per-frame cost. See the scripts in the repo's test notes.
```