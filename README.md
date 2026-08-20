# pi-tidy-tools

A tidy tool-rendering extension for [Pi](https://github.com/earendil-works/pi-mono) (the pi-coding-agent TUI). It overrides the rendering of `bash`, `edit` and `write`: compact summaries by default, full official rendering when you need it.

[中文版](README.zh-CN.md)

## Default view

Each tool starts in one of two states:

| Tool | Default | What you see |
|---|---|---|
| `bash` | **Collapsed** | `$ command`, one output line, and `... (N more lines)` if there is more output |
| `edit` | **Expanded** | Pi's official renderer: path, block count, live diff preview, native layout |
| `write` | **Expanded** | Pi's official renderer: path, line count, syntax-highlighted content |

Collapsed summaries are single-line (bash shows one preview line plus a count row).

## Shortcuts

| Shortcut | Tool | Toggles between |
|---|---|---|
| `Ctrl+Alt+B` | `bash` | collapsed summary ↔ **one-key full output** |
| `Ctrl+Alt+E` | `edit` | official rendering ↔ collapsed summary |
| `Ctrl+Alt+W` | `write` | official rendering ↔ collapsed summary |

A notification shows the current state on each toggle; press again to switch back.

`bash` expands to the **complete output** in one keypress — it skips Pi's built-in 5-line tail preview. `edit` and `write` expand to Pi's **official default rendering**: they delegate to the official renderers, and whether the content itself is further expanded is still controlled by the global `Ctrl+O`, exactly as without this extension. Only `bash` ignores `Ctrl+O` in its expanded state.

## Usage

Load the extension:

```bash
pi -e ./tidy-tools.ts
```

Or install as a pi package:

```bash
pi install @runminton/pi-tidy-tools
```

Or copy `tidy-tools.ts` into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project) and restart Pi.

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
3. **Custom keys.** The bindings are registered in `tidy-tools.ts` via `pi.registerShortcut(...)` — edit the key strings there to rebind. Pi's built-in global expansion (`Ctrl+O`, `app.tools.expand`) is configured separately via `~/.pi/agent/keybindings.json`.

## Development

```bash
# Type-check with the repo tsconfig (resolves Pi types via the symlinked
# global install in node_modules/)
tsc --noEmit

# Smoke test: renders collapsed/expanded states with a fake extension host, and
# benchmarks per-frame cost. See the scripts in the repo's test notes.
```