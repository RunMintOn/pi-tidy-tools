/**
 * Compact Tool Rendering Extension
 *
 * Overrides the TUI rendering of bash, edit and write while keeping the
 * official implementations (delegated execution, never truncated):
 * - Collapsed (default): show at most three terminal lines, keeping the
 *   beginning, with an ellipsis marking omitted content.
 *   - bash: the command
 *   - edit: path, block count, old/new first lines; result shows diff stats
 *   - write: path, line count, first content lines
 * - Expanded (Ctrl+O): full content; built-in renderers are invoked with the
 *   original context, so edit's live diff preview and write's syntax
 *   highlighting keep working.
 *
 * Usage:
 *   pi -e ./minimal-mode.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
    createBashTool,
    createEditToolDefinition,
    createWriteToolDefinition,
    renderDiff,
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

/** Colorize a few leading diff lines for the collapsed view. */
function diffHead(diff: string, theme: Parameters<NonNullable<ToolDefinition["renderCall"]>>[1], maxLines: number): string {
    const lines: string[] = [];
    for (const line of diff.split("\n")) {
        if (lines.length >= maxLines) break;
        if (line.startsWith("+") && !line.startsWith("+++")) lines.push(theme.fg("success", line));
        else if (line.startsWith("-") && !line.startsWith("---")) lines.push(theme.fg("error", line));
        else if (line.startsWith("@")) lines.push(theme.fg("muted", line));
        else lines.push(theme.fg("dim", line));
    }
    return lines.join("\n");
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

function getBashTool(cwd: string) {
    let tool = bashToolCache.get(cwd);
    if (!tool) {
        tool = createBashTool(cwd);
        bashToolCache.set(cwd, tool);
    }
    return tool;
}

/**
 * Re-register a built-in tool with collapsed-by-default rendering.
 *
 * - Collapsed: a custom compact summary is drawn; the built-in renderer is
 *   not invoked, so its internal state (e.g. edit's live diff preview) is
 *   left untouched.
 * - Expanded (Ctrl+O): the built-in renderer is invoked with the original
 *   context, so its state machine picks up where it left off (live preview,
 *   syntax highlighting, etc.).
 *
 * The official definition is resolved per session cwd via getDef, matching
 * how the bash override below resolves its tool per cwd.
 */
function registerCollapsibleTool(
    pi: ExtensionAPI,
    getDef: (cwd: string) => ToolDefinition<any, any, any>,
    collapsedCall: (args: any, theme: any) => Component,
    collapsedResult: (result: any, options: any, theme: any, context: any) => Component,
    expandedResult: (result: any, options: any, theme: any, context: any) => Component,
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
        renderShell: def.renderShell,

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            return getDef(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },

        renderCall(args, theme, context) {
            if (context.expanded) {
                return getDef(context.cwd).renderCall!(args as never, theme as never, context as never);
            }
            return collapsedCall(args, theme);
        },

        renderResult(result, options, theme, context) {
            if (options.expanded) {
                return expandedResult(result, options, theme, context);
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
            const command = args.command || "...";
            const timeout = args.timeout as number | undefined;
            const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
            const renderedCommand = theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix;

            if (context.expanded) {
                return new Text(renderedCommand, 0, 0);
            }

            return new LimitedLinesText(
                renderedCommand,
                MAX_COLLAPSED_COMMAND_LINES,
                theme.fg("muted", "..."),
            );
        },
    });

    // --- Edit tool: collapsed diff summary, expanded shows the full preview ---
    registerCollapsibleTool(
        pi,
        getEditDef,
        (args, theme) => {
            const path = String(args.path ?? "");
            const edits: { oldText?: string; newText?: string }[] = Array.isArray(args.edits) ? args.edits : [];
            let text = theme.fg("toolTitle", theme.bold("edit ")) + theme.fg("accent", path);
            if (edits.length > 0) {
                text += theme.fg("dim", ` (${edits.length} block${edits.length > 1 ? "s" : ""})`);
                for (const edit of edits) {
                    const oldFirst = firstLine(edit.oldText);
                    const newFirst = firstLine(edit.newText);
                    if (oldFirst) text += `\n${theme.fg("error", `- ${oldFirst}`)}`;
                    if (newFirst) text += `\n${theme.fg("success", `+ ${newFirst}`)}`;
                }
            }
            return new LimitedLinesText(text, MAX_COLLAPSED_CONTENT_LINES, theme.fg("muted", "..."));
        },
        (result, _options, theme, context) => {
            const path = String(context.args?.path ?? "");
            if (context.isError) {
                return new Text(theme.fg("error", `edit ${path} failed: ${firstLine(errorText(result))}`), 0, 0);
            }
            const diff = (result.details as EditToolDetails | undefined)?.diff;
            if (!diff) {
                return new Text(theme.fg("success", `edit ${path} applied`), 0, 0);
            }
            const { additions, removals } = diffStats(diff);
            const text =
                theme.fg("success", `edit ${path}`) +
                theme.fg("dim", ` +${additions} -${removals}`) +
                `\n${diffHead(diff, theme, MAX_COLLAPSED_CONTENT_LINES)}`;
            return new LimitedLinesText(text, MAX_COLLAPSED_CONTENT_LINES, theme.fg("muted", "..."));
        },
        (result, _options, theme, context) => {
            const path = String(context.args?.path ?? "");
            if (context.isError) {
                return new Text(theme.fg("error", errorText(result)), 0, 0);
            }
            const diff = (result.details as EditToolDetails | undefined)?.diff;
            if (!diff) {
                return new Text(theme.fg("success", `edit ${path} applied`), 0, 0);
            }
            return new Text(renderDiff(diff, { filePath: path }), 0, 0);
        },
    );

    // --- Write tool: collapsed shows path + first lines, expanded shows everything ---
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
            const path = String(context.args?.path ?? "");
            if (context.isError) {
                return new Text(theme.fg("error", `write ${path} failed: ${firstLine(errorText(result))}`), 0, 0);
            }
            return new Text(theme.fg("success", `write ${path} done`), 0, 0);
        },
        (result, _options, theme, context) => {
            const path = String(context.args?.path ?? "");
            if (context.isError) {
                return new Text(theme.fg("error", errorText(result)), 0, 0);
            }
            return new Text(theme.fg("success", `write ${path} done`), 0, 0);
        },
    );
}

