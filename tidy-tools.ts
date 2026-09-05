/**
 * Compact Tool Rendering Extension
 *
 * Overrides the TUI rendering of bash, edit and write while delegating
 * execution to the official implementations:
 * - Collapsed: show a small summary with an ellipsis for long content.
 * - Expanded: Ctrl+Alt+E (edit), Ctrl+Alt+W (write), Ctrl+Alt+B (bash)
 *   toggle each tool between collapsed and fully expanded rendering.
 * - The global Ctrl+O tool expansion does not affect these three tools.
 * - Modes: compact (default, all three collapsed) and markdown
 *   (`/tidy-markdown` toggles; edit/write on Markdown files expand,
 *   the rest stays collapsed). Not persisted across restarts.
 *
 * Usage:
 *   pi -e ./tidy-tools.ts
 */

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
    createBashTool,
    createBashToolDefinition,
    createEditToolDefinition,
    createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { EditToolDetails } from "@earendil-works/pi-coding-agent";
import {
    Box,
    Container,
    Text,
    type Component,
    sliceByColumn,
    visibleWidth,
    wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const MAX_COLLAPSED_COMMAND_LINES = 1;
const MAX_COLLAPSED_CONTENT_LINES = 3;
// bash 折叠输出：预览与计数后缀合并为 1 行（命令 1 行 + 输出 1 行）。
const MAX_COLLAPSED_BASH_OUTPUT_LINES = 1;

/**
 * Truncate rendered rows to at most maxLines, keeping the beginning.
 * The last line is shortened and an ellipsis marks omitted content.
 */
function truncateRows(rows: string[], maxLines: number, ellipsis: string, width: number): string[] {
    if (rows.length <= maxLines) {
        return rows;
    }

    const lines = rows.slice(0, maxLines);
    const lastIndex = lines.length - 1;
    const lastLine = lines[lastIndex] ?? "";
    const ellipsisWidth = visibleWidth(ellipsis);

    if (ellipsisWidth >= width) {
        lines[lastIndex] = sliceByColumn(ellipsis, 0, Math.max(1, width), true);
    } else {
        const contentWidth = width - ellipsisWidth;
        lines[lastIndex] = `${sliceByColumn(lastLine, 0, contentWidth, true)}${ellipsis}`;
    }

    return lines;
}

function firstLine(text: string | undefined): string {
    if (!text) return "";
    const line = text.split("\n")[0] ?? "";
    return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

// 终端 tab 按 8 的倍数对齐，pi-tui 按 3 列计算。不展开 tab 会导致
// 行宽估算小于终端实际渲染，窄终端下折成两行。与官方 replaceTabs
// 保持一致：tab 展开为 3 个空格。

function expandTabs(text: string): string {
    return text.replace(/\t/g, "   ");
}

function errorText(result: { content: { type: string; text?: string }[] }): string {
    return result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
}

function diffStats(diff: string): { additions: number; removals: number } {
    let additions = 0;
    let removals = 0;
    for (const line of diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) removals++;
    }
    return { additions, removals };
}

/**
 * Render text with a width-aware maximum number of lines.
 * The beginning is kept and an ellipsis marks omitted content.
 */
class LimitedLinesText implements Component {
    constructor(
        private readonly text: string,
        private readonly maxLines: number,
        private readonly ellipsis: string,
    ) {}

    private cachedWidth?: number;
    private cachedLines?: string[];

    render(width: number): string[] {
        // The TUI calls render() on every frame. Cache the wrapped result so
        // a frame only re-wraps when the width actually changes.
        if (this.cachedLines !== undefined && this.cachedWidth === width) {
            return this.cachedLines;
        }
        const lines = truncateRows(
            wrapTextWithAnsi(this.text, Math.max(1, width)),
            this.maxLines,
            this.ellipsis,
            width,
        );
        this.cachedWidth = width;
        this.cachedLines = lines;
        return lines;
    }

    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}

class CollapsedBashOutput implements Component {
    // 首行预览 + 计数后缀合并为 1 行，后缀常显。预览放不下时截断并加省略标记。
    constructor(
        private readonly preview: string,
        private readonly suffix: string,
        private readonly truncatedMarker: string,
    ) {}

    render(width: number): string[] {
        if (!this.suffix) {
            return truncateRows(
                wrapTextWithAnsi(this.preview, Math.max(1, width)),
                MAX_COLLAPSED_BASH_OUTPUT_LINES,
                this.truncatedMarker,
                width,
            );
        }
        const suffixWidth = visibleWidth(this.suffix);
        if (suffixWidth >= width) {
            return [sliceByColumn(this.suffix, 0, Math.max(1, width), true)];
        }
        const previewBudget = width - suffixWidth - 1;
        if (visibleWidth(this.preview) <= previewBudget) {
            return [`${this.preview} ${this.suffix}`];
        }
        const markerWidth = visibleWidth(this.truncatedMarker);
        const preview = sliceByColumn(
            this.preview,
            0,
            Math.max(0, previewBudget - markerWidth),
            true,
        );
        const row = `${preview}${this.truncatedMarker} ${this.suffix}`;
        // 极窄宽度下省略标记本身都放不下时做最终钳制，保证恒为 1 行。
        return [visibleWidth(row) > width ? sliceByColumn(row, 0, width, true) : row];
    }

    invalidate(): void {}
}

class CollapsedToolShell extends Box {
    private callComponent?: Component;
    private resultComponent?: Component;

    constructor(theme: any, background: string) {
        super(1, 1, (text) => theme.bg(background, text));
    }

    setBackground(theme: any, background: string): void {
        this.setBgFn((text) => theme.bg(background, text));
    }

    setCall(component: Component): void {
        this.callComponent = component;
        this.rebuild();
    }

    setResult(component: Component): void {
        this.resultComponent = component;
        this.rebuild();
    }

    private rebuild(): void {
        this.clear();
        if (this.callComponent) this.addChild(this.callComponent);
        if (this.resultComponent) this.addChild(this.resultComponent);
    }
}

function getCollapsedToolShell(state: any, theme: any, background: string): CollapsedToolShell {
    const shell = (state.collapsedToolShell as CollapsedToolShell | undefined) ?? new CollapsedToolShell(theme, background);
    state.collapsedToolShell = shell;
    shell.setBackground(theme, background);
    return shell;
}

function getCollapsedBackground(isPartial: boolean, isError: boolean): string {
    if (isPartial) return "toolPendingBg";
    return isError ? "toolErrorBg" : "toolSuccessBg";
}

// 显示模式：compact 下三工具默认全折叠；markdown 模式下 edit/write 遇到
// Markdown 文件默认展开全文，其余照样折叠。默认 compact，不持久化。
let markdownMode = false;
// 手动钉选：Ctrl+Alt+? 或 /tidy-<tool> 设置，优先于模式默认；切换模式时清空。
const manualExpanded = new Map<string, boolean>();

function isMarkdownPath(value: unknown): boolean {
    if (typeof value !== "string") return false;
    return /\.(md|mdx|markdown)$/i.test(value.trim());
}

function toolArgsMarkdown(args: any): boolean {
    return isMarkdownPath(args?.path) || isMarkdownPath(args?.file_path);
}

// 不带文件上下文的工具级基准（用于翻转手动钉选）：compact 下全 false；
// markdown 模式下 edit/write 为 true（具体到文件时再按后缀细化）。
function modeBaseExpanded(name: string): boolean {
    if (!markdownMode) return false;
    return name === "edit" || name === "write";
}

function modeDefaultExpanded(name: string, args: any): boolean {
    if (!markdownMode) return false;
    if (name === "edit" || name === "write") return toolArgsMarkdown(args);
    return false;
}

function isToolExpanded(name: string, args: any): boolean {
    return manualExpanded.get(name) ?? modeDefaultExpanded(name, args);
}

// Some terminals (Kitty keyboard protocol flag-1 mode) encode Ctrl+letter as
// a CSI-u sequence using the control character code without a Ctrl modifier
// bit, e.g. Ctrl+Alt+E arrives as \x1b[5;3:1u (5 = Ctrl+E, mod = Alt). Pi
// only recognizes the ASCII-code + full-modifier form (\x1b[101;7u), so we
// rewrite the three shortcuts into the form Pi understands. All other input
// passes through unchanged.
const CTRL_CODE_TO_KEY: Record<number, string> = {
    5: "e", // Ctrl+E
    23: "w", // Ctrl+W
    2: "b", // Ctrl+B
};
const ALT_MODIFIER = 2;
let debugNextTerminalInput = false;

function convertCtrlAltSequence(data: string): string | undefined {
    // Legacy terminals send Ctrl+Alt+letter as ESC followed by the Ctrl
    // character. Pi deliberately ignores this form after Kitty negotiation,
    // so normalize it before Pi's key matcher sees it.
    if (data.length === 2 && data[0] === "\x1b") {
        const key = CTRL_CODE_TO_KEY[data.charCodeAt(1)];
        if (key) return `\x1b[${key.charCodeAt(0)};7u`; // 7 = Ctrl|Alt (1-indexed)
    }

    const match = data.match(/^\x1b\[(\d+);(\d+)(?::(\d+))?u$/);
    if (!match) return undefined;
    const code = Number(match[1]);
    const modifier = Number(match[2]) - 1; // CSI-u modifiers are 1-indexed
    const key = CTRL_CODE_TO_KEY[code];
    if (!key || (modifier & ALT_MODIFIER) === 0) return undefined;
    const eventSuffix = match[3] ? `:${match[3]}` : "";
    return `\x1b[${key.charCodeAt(0)};7${eventSuffix}u`; // 7 = Ctrl|Alt (1-indexed)
}

function refreshToolRows(ctx: ExtensionContext): void {
    const globalExpanded = ctx.ui.getToolsExpanded();
    // Force every tool row to re-render. The global value is restored
    // immediately, so only the rows' renderers refresh, not the global state.
    ctx.ui.setToolsExpanded(!globalExpanded);
    ctx.ui.setToolsExpanded(globalExpanded);
}

function toggleToolExpanded(ctx: ExtensionContext, name: string): void {
    manualExpanded.set(name, !(manualExpanded.get(name) ?? modeBaseExpanded(name)));
    refreshToolRows(ctx);
    ctx.ui.notify(`${name}: ${manualExpanded.get(name) ? "expanded" : "collapsed"}`, "info");
}

// Cache the official tool implementation by working directory, as pi may run
// the same extension against more than one session cwd.
const bashToolCache = new Map<string, ReturnType<typeof createBashTool>>();
const bashDefCache = new Map<string, ReturnType<typeof createBashToolDefinition>>();

function getBashTool(cwd: string) {
    let tool = bashToolCache.get(cwd);
    if (!tool) {
        tool = createBashTool(cwd);
        bashToolCache.set(cwd, tool);
    }
    return tool;
}

function getBashDef(cwd: string) {
    let def = bashDefCache.get(cwd);
    if (!def) {
        def = createBashToolDefinition(cwd);
        bashDefCache.set(cwd, def);
    }
    return def;
}

/**
 * Re-register a built-in tool with collapsed rendering and official
 * rendering when that tool is expanded via its own shortcut. The built-in
 * render shell is preserved so expanded views keep their native layout.
 */
function registerCollapsibleTool(
    pi: ExtensionAPI,
    getDef: (cwd: string) => ToolDefinition<any, any, any>,
    collapsedCall: (args: any, theme: any) => Component,
    collapsedResult: (result: any, options: any, theme: any, context: any) => Component,
    // 跳过官方预览态，展开即全文（bash 行为）。为 false 时保留官方默认视图，
    // 其内部预览 / 全文仍由全局 Ctrl+O 决定。
    forceFullExpansion = false,
) {
    const def = getDef(process.cwd());
    const usesSelfShell = def.renderShell === "self";
    pi.registerTool({
        name: def.name,
        label: def.label,
        description: def.description,
        promptSnippet: def.promptSnippet,
        promptGuidelines: def.promptGuidelines,
        parameters: def.parameters,
        prepareArguments: def.prepareArguments,
        constrainedSampling: def.constrainedSampling,
        // Mirror the official renderShell. Omitting it falls back to
        // "default", which double-wraps "self" tools like edit in an
        // extra Box: one extra padding line on top and bottom when
        // expanded, and a Box-in-Box when collapsed.
        ...(usesSelfShell ? { renderShell: "self" as const } : {}),

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            return getDef(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },

        renderCall(args, theme, context) {
            const def = getDef(context.cwd);
            if (isToolExpanded(def.name, args) && def.renderCall) {
                return def.renderCall(
                    args as never,
                    theme as never,
                    // One-key full expansion: skip the official preview so
                    // the per-tool shortcut always shows complete output.
                    {
                        ...context,
                        ...(forceFullExpansion ? { expanded: true } : {}),
                        lastComponent: undefined,
                    } as never,
                );
            }
            const component = collapsedCall(args, theme);
            if (!usesSelfShell) return component;

            const shell = getCollapsedToolShell(
                context.state,
                theme,
                getCollapsedBackground(context.isPartial, context.isError),
            );
            shell.setCall(component);
            return shell;
        },

        renderResult(result, options, theme, context) {
            const def = getDef(context.cwd);
            if (isToolExpanded(def.name, context.args) && def.renderResult) {
                return def.renderResult(
                    result as never,
                    { ...options, ...(forceFullExpansion ? { expanded: true } : {}) } as never,
                    theme as never,
                    { ...context, lastComponent: undefined } as never,
                );
            }
            const component = collapsedResult(result, options, theme, context);
            if (!usesSelfShell) return component;

            const shell = getCollapsedToolShell(
                context.state,
                theme,
                getCollapsedBackground(options.isPartial, context.isError),
            );
            shell.setResult(component);
            return new Container();
        },
    });
}

// Cache the official tool definitions by working directory, as pi may run
// the same extension against more than one session cwd.
const editDefCache = new Map<string, ToolDefinition<any, any, any>>();
const writeDefCache = new Map<string, ToolDefinition<any, any, any>>();

function getEditDef(cwd: string) {
    let def = editDefCache.get(cwd);
    if (!def) {
        def = createEditToolDefinition(cwd);
        editDefCache.set(cwd, def);
    }
    return def;
}

function getWriteDef(cwd: string) {
    let def = writeDefCache.get(cwd);
    if (!def) {
        def = createWriteToolDefinition(cwd);
        writeDefCache.set(cwd, def);
    }
    return def;
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "bash",
        label: "bash",
        description:
            "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first).",
        parameters: getBashTool(process.cwd()).parameters,

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const tool = getBashTool(ctx.cwd);
            return tool.execute(toolCallId, params, signal, onUpdate);
        },

        renderCall(args, theme, context) {
            if (isToolExpanded("bash", args)) {
                const def = getBashDef(context.cwd);
                if (def.renderCall) {
                    return def.renderCall(
                        args as never,
                        theme as never,
                        // One-key full expansion for bash: skip the official
                        // preview so Ctrl+Alt+B shows the complete output.
                        { ...context, expanded: true, lastComponent: undefined } as never,
                    );
                }
            }

            const rawCommand = args.command || "...";
            const command = typeof rawCommand === "string" ? expandTabs(rawCommand) : "...";
            const timeout = args.timeout as number | undefined;
            const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
            const renderedCommand = theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix;

            return new LimitedLinesText(
                renderedCommand,
                MAX_COLLAPSED_COMMAND_LINES,
                theme.fg("muted", "..."),
            );
        },

        renderResult(result, options, theme, context) {
            if (isToolExpanded("bash", context.args)) {
                const def = getBashDef(context.cwd);
                if (def.renderResult) {
                    return def.renderResult(
                        result as never,
                        // One-key full expansion for bash: skip the official
                        // preview so Ctrl+Alt+B shows the complete output.
                        { ...options, expanded: true } as never,
                        theme as never,
                        { ...context, lastComponent: undefined } as never,
                    );
                }
            }

            const output = expandTabs(errorText(result).trim().replace(/\r/g, ""));
            const allLines = output.split("\n");
            const first = allLines[0] ?? "";
            const moreSuffix =
                allLines.length > 1
                    ? theme.fg("muted", `... (${allLines.length - 1} more lines)`)
                    : "";
            // 失败输出同样压成 1 行：红色首行 + 内联计数，与成功态同形。
            if (context.isError) {
                if (!first) {
                    return new CollapsedBashOutput(
                        theme.fg("error", "failed"),
                        "",
                        theme.fg("muted", "..."),
                    );
                }
                return new CollapsedBashOutput(
                    theme.fg("error", first),
                    moreSuffix,
                    theme.fg("muted", "..."),
                );
            }
            // Preview only the first line. Wrapping the full output on every
            // frame is what made the TUI lag with large outputs.
            if (!first) {
                return new CollapsedBashOutput(
                    theme.fg("muted", "(no output)"),
                    "",
                    theme.fg("muted", "..."),
                );
            }
            return new CollapsedBashOutput(
                theme.fg("toolOutput", first),
                moreSuffix,
                theme.fg("muted", "..."),
            );
        },
    });

    // --- Edit tool: collapsed diff summary ---
    registerCollapsibleTool(
        pi,
        getEditDef,
        (args, theme) => {
            const path = String(args.path ?? "");
            const edits: { oldText?: string; newText?: string }[] = Array.isArray(args.edits) ? args.edits : [];
            let text = theme.fg("toolTitle", theme.bold("edit ")) + theme.fg("accent", path);
            if (edits.length > 0) {
                text += theme.fg("dim", ` (${edits.length} block${edits.length > 1 ? "s" : ""})`);
            }
            return new LimitedLinesText(text, 1, theme.fg("muted", "..."));
        },
        (result, _options, theme, context) => {
            if (context.isError) {
                return new LimitedLinesText(
                    theme.fg("error", `failed: ${firstLine(errorText(result))}`),
                    1,
                    theme.fg("muted", "..."),
                );
            }
            const diff = (result.details as EditToolDetails | undefined)?.diff;
            if (!diff) {
                return new Text(theme.fg("success", "applied"), 0, 0);
            }
            const { additions, removals } = diffStats(diff);
            return new Text(
                theme.fg("success", "applied") + theme.fg("dim", ` +${additions} -${removals}`),
                0,
                0,
            );
        },
    );

    // --- Write tool: collapsed shows path + line count ---
    registerCollapsibleTool(
        pi,
        getWriteDef,
        (args, theme) => {
            const path = String(args.path ?? "");
            const content = String(args.content ?? "");
            const lines = content.split("\n");
            let text = theme.fg("toolTitle", theme.bold("write ")) + theme.fg("accent", path);
            text += theme.fg("dim", ` (${lines.length} lines)`);
            return new LimitedLinesText(text, 1, theme.fg("muted", "..."));
        },
        (result, _options, theme, context) => {
            if (context.isError) {
                return new Text(theme.fg("error", `failed: ${firstLine(errorText(result))}`), 0, 0);
            }
            return new Text(theme.fg("success", "done"), 0, 0);
        },
        // 展开即全文，跳过官方 10 行预览：三工具统一两档，Ctrl+O 彻底失效。
        true,
    );

    pi.registerCommand("tidy-bash", {
        description: "Toggle bash output expansion",
        handler: async (_args, ctx) => toggleToolExpanded(ctx, "bash"),
    });
    pi.registerCommand("tidy-edit", {
        description: "Toggle edit output expansion",
        handler: async (_args, ctx) => toggleToolExpanded(ctx, "edit"),
    });
    pi.registerCommand("tidy-write", {
        description: "Toggle write output expansion",
        handler: async (_args, ctx) => toggleToolExpanded(ctx, "write"),
    });
    pi.registerCommand("tidy-markdown", {
        description: "Toggle markdown mode (edit/write expand for Markdown files)",
        handler: async (_args, ctx) => {
            markdownMode = !markdownMode;
            manualExpanded.clear();
            refreshToolRows(ctx);
            ctx.ui.notify(`markdown mode: ${markdownMode ? "on" : "off"}`, "info");
        },
    });
    pi.registerCommand("tidy-key-debug", {
        description: "Show the next raw terminal key sequence",
        handler: async (_args, ctx) => {
            debugNextTerminalInput = true;
            ctx.ui.notify("Press one key to inspect its terminal sequence.", "info");
        },
    });

    // --- Per-tool expansion shortcuts, independent of the global Ctrl+O ---
    pi.registerShortcut("ctrl+alt+e", {
        description: "Toggle edit expansion",
        handler: (ctx) => toggleToolExpanded(ctx, "edit"),
    });
    pi.registerShortcut("ctrl+alt+w", {
        description: "Toggle write expansion",
        handler: (ctx) => toggleToolExpanded(ctx, "write"),
    });
    pi.registerShortcut("ctrl+alt+b", {
        description: "Toggle bash expansion",
        handler: (ctx) => toggleToolExpanded(ctx, "bash"),
    });

    // Some terminals encode Ctrl+Alt+letter as a control-character CSI-u
    // sequence. Rewrite those three sequences before they reach the editor.
    pi.on("session_start", (_event, ctx) => {
        ctx.ui.onTerminalInput((data) => {
            const converted = convertCtrlAltSequence(data);
            if (debugNextTerminalInput) {
                debugNextTerminalInput = false;
                const bytes = [...data].map((char) => char.charCodeAt(0)).join(", ");
                ctx.ui.notify(
                    `raw: ${JSON.stringify(data)} [${bytes}]${converted ? ` → ${JSON.stringify(converted)}` : ""}`,
                    "info",
                );
            }
            return converted ? { data: converted } : undefined;
        });
    });
}

