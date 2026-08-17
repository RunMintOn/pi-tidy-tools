/**
 * Compact Tool Rendering Extension
 *
 * Overrides the TUI rendering of bash, edit and write while delegating
 * execution to the official implementations:
 * - Collapsed: show a small summary with an ellipsis for long content.
 * - Expanded (Ctrl+O): delegate rendering to the official implementations.
 *
 * Usage:
 *   pi -e ./minimal-mode.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
    createBashTool,
    createBashToolDefinition,
    createEditToolDefinition,
    createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { EditToolDetails } from "@earendil-works/pi-coding-agent";
import {
    Text,
    type Component,
    sliceByColumn,
    visibleWidth,
    wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const MAX_COLLAPSED_COMMAND_LINES = 3;
const MAX_COLLAPSED_CONTENT_LINES = 3;

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

    render(width: number): string[] {
        return truncateRows(wrapTextWithAnsi(this.text, Math.max(1, width)), this.maxLines, this.ellipsis, width);
    }

    invalidate(): void {}
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
 * rendering when the global tool-output view is expanded.
 */
function registerCollapsibleTool(
    pi: ExtensionAPI,
    getDef: (cwd: string) => ToolDefinition<any, any, any>,
    collapsedCall: (args: any, theme: any) => Component,
    collapsedResult: (result: any, options: any, theme: any, context: any) => Component,
) {
    const def = getDef(process.cwd());
    pi.registerTool({
        name: def.name,
        label: def.label,
        description: def.description,
        promptSnippet: def.promptSnippet,
        promptGuidelines: def.promptGuidelines,
        parameters: def.parameters,
        prepareArguments: def.prepareArguments,
        constrainedSampling: def.constrainedSampling,
        // The custom renderer does not draw its own frame. Keep the normal
        // tool container so collapsed output has padding and a background.
        renderShell: "default",

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            return getDef(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },

        renderCall(args, theme, context) {
            const def = getDef(context.cwd);
            if (context.expanded && def.renderCall) {
                return def.renderCall(
                    args as never,
                    theme as never,
                    { ...context, lastComponent: undefined } as never,
                );
            }
            return collapsedCall(args, theme);
        },

        renderResult(result, options, theme, context) {
            const def = getDef(context.cwd);
            if (options.expanded && def.renderResult) {
                return def.renderResult(
                    result as never,
                    options as never,
                    theme as never,
                    { ...context, lastComponent: undefined } as never,
                );
            }
            return collapsedResult(result, options, theme, context);
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
            if (context.expanded) {
                const def = getBashDef(context.cwd);
                if (def.renderCall) {
                    return def.renderCall(
                        args as never,
                        theme as never,
                        { ...context, lastComponent: undefined } as never,
                    );
                }
            }

            const command = args.command || "...";
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
            if (options.expanded) {
                const def = getBashDef(context.cwd);
                if (def.renderResult) {
                    return def.renderResult(
                        result as never,
                        options as never,
                        theme as never,
                        { ...context, lastComponent: undefined } as never,
                    );
                }
            }

            const output = errorText(result).trim();
            if (context.isError) {
                return new LimitedLinesText(
                    theme.fg("error", firstLine(output) || "failed"),
                    MAX_COLLAPSED_CONTENT_LINES,
                    theme.fg("muted", "..."),
                );
            }
            return new LimitedLinesText(
                theme.fg("toolOutput", output || "(no output)"),
                MAX_COLLAPSED_CONTENT_LINES,
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

    // --- Write tool: collapsed shows path + first lines ---
    registerCollapsibleTool(
        pi,
        getWriteDef,
        (args, theme) => {
            const path = String(args.path ?? "");
            const content = String(args.content ?? "");
            const lines = content.split("\n");
            let text = theme.fg("toolTitle", theme.bold("write ")) + theme.fg("accent", path);
            text += theme.fg("dim", ` (${lines.length} lines)`);
            if (content) {
                text += `\n${lines
                    .slice(0, MAX_COLLAPSED_CONTENT_LINES)
                    .map((line) => theme.fg("toolOutput", line))
                    .join("\n")}`;
            }
            return new LimitedLinesText(text, MAX_COLLAPSED_CONTENT_LINES, theme.fg("muted", "..."));
        },
        (result, _options, theme, context) => {
            if (context.isError) {
                return new Text(theme.fg("error", `failed: ${firstLine(errorText(result))}`), 0, 0);
            }
            return new Text(theme.fg("success", "done"), 0, 0);
        },
    );
}

