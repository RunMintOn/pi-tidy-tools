# pi-tidy-tools

A tidy tool-rendering extension for [Pi](https://github.com/earendil-works/pi-mono) (the pi-coding-agent TUI). It overrides the rendering of `bash`, `edit` and `write`: compact summaries by default, full official rendering when you need it.

> Display layer only. Tool execution is fully delegated to Pi's official implementations — parameters, behavior and results are untouched; the extension only decides how many rows to draw and in which colors.

[中文版](README.zh-CN.md)

## Default view

All three tools start **Collapsed**:

| Tool | Collapsed summary | Expanded |
|---|---|---|
| `bash` | `$ command` plus one output line, with an inline `... (N more lines)` suffix when truncated | complete output |
| `edit` | `edit path (N blocks)` + `applied +a -b` | Pi's official renderer: path, block count, live diff preview, native layout |
| `write` | `write path (N lines)` + `done` | Pi's official renderer: path, line count, syntax-highlighted content |

Collapsed summaries are single-line per slot: one command line plus one output line (the count suffix is inline at the end of the output line).

## Modes

| Mode | Behavior |
|---|---|
| compact (default) | all three tools collapsed |
| markdown (`/tidy-markdown` toggles) | `edit`/`write` on Markdown files (`.md`, `.mdx`, `.markdown`) expand to full content; everything else stays collapsed |

Switching modes clears per-tool manual toggles and re-renders existing rows. The mode is not persisted across restarts.

## Shortcuts

On Mac press `Command+Option+letter` (verified; maps to the registered `Ctrl+Alt+letter`. Other platforms press `Ctrl+Alt+letter`):

| Shortcut (Mac) | Tool | Toggles between |
|---|---|---|
| `Command+Option+B` | `bash` | collapsed summary ↔ **one-key full output** |
| `Command+Option+E` | `edit` | official rendering ↔ collapsed summary |
| `Command+Option+W` | `write` | official rendering ↔ collapsed summary |

A notification shows the current state on each toggle; press again to switch back.

`bash` and `write` expand to the **complete output** in one keypress — they skip Pi's built-in previews (bash's 5-line tail preview, write's 10-line preview). `edit` expands to Pi's **official rendering** (it has no preview state). The global `Ctrl+O` tool expansion does not affect these three tools.

## Commands

Use these commands when terminal shortcuts conflict or are not delivered:

| Command | Tool |
|---|---|
| `/tidy-bash` | Toggle `bash` output |
| `/tidy-edit` | Toggle `edit` output |
| `/tidy-write` | Toggle `write` output |
| `/tidy-markdown` | Toggle markdown mode (edit/write expand for Markdown files) |

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
4. **Inspect the input.** Run `/tidy-key-debug`, then press one target shortcut. Pi shows the received bytes and any rewrite. If no notification appears, the terminal or input method consumed the key before Pi received it.

## Changelog

### 0.2.0

- All three tools collapsed by default (edit/write used to expand)
- New `/tidy-markdown`: edit/write on Markdown files auto-expand to full content, the rest stays collapsed; switching modes clears manual toggles
- Write expansion skips the official 10-line preview and shows full content; global `Ctrl+O` no longer affects any of the three tools
- Bash collapsed output is 2 rows with the count suffix inline, including error output
- Fixed tab-width overflow wrapping collapsed bash output on narrow terminals; fixed doubled edit padding from a nested render shell

### 0.1.3

- New `/tidy-bash`, `/tidy-edit`, `/tidy-write`, `/tidy-key-debug` commands
- Normalized the legacy `ESC` + control-character shortcut form

## Development

```bash
# Type-check with the repo tsconfig (resolves Pi types via the symlinked
# global install in node_modules/)
tsc --noEmit

# Smoke test: renders collapsed/expanded states with a fake extension host, and
# benchmarks per-frame cost. See the scripts in the repo's test notes.
```