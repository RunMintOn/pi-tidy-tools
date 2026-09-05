---
name: tool-render-customization
description: 修改本项目工具渲染插件（tidy-tools.ts）时使用。覆盖渲染机制：同名工具代理、renderShell、两层展开、lastComponent、折叠摘要、快捷键。用户要求自定义或调整 bash、edit、write 的折叠、展开、默认状态、外框样式时加载。
---

# 工具渲染插件自定义指南

本项目的 `tidy-tools.ts` 覆盖 Pi TUI 中 `bash`、`edit`、`write` 的渲染。本 skill 提供修改它所需的知识：先认清机制，再动手改。

## 何时使用

用户要求调整以下任何一项时加载本 skill：

- 某个工具默认折叠还是展开
- 折叠摘要的内容、行数、外框样式
- 展开行为（官方默认视图 vs 一键完整展开）
- 快捷键绑定
- 新增工具覆盖

## 核心机制（修改前必读）

### 1. 同名工具代理

`pi.registerTool({ name: "edit", ... })` 整体替换内置工具。本插件只替换渲染层：

- `execute` → 委托官方实现（`getEditDef(ctx.cwd).execute(...)`）
- `renderCall` / `renderResult` → 插件自己的显示逻辑
- `renderShell` 必须显式镜像官方值（edit 设 `"self"`，bash/write 保持默认）。省略会回落到 `"default"`，不会继承原工具——之前省略导致展开的 edit 被双层 Box 包裹、上下各多一行 padding

### 2. 两层展开，不要混淆

- **插件层**：两块状态。`manualExpanded` Map：Ctrl+Alt+? 或 `/tidy-<tool>` 设的手动钉选，优先。`markdownMode` 布尔值：`/tidy-markdown` 切换，compact 下默认全折叠，markdown 模式下 edit/write 遇 Markdown 文件（`.md`、`.mdx`、`.markdown`，看 `path` / `file_path`）默认展开。切模式清空手动钉选。
- **官方层**：官方 renderer 内部的 expanded 状态，由全局 `Ctrl+O` 控制。

委托官方 renderer 时，传什么 `options` / `context` 决定用官方哪一层：

- **不强制**：官方默认视图（内容预览 / 全文仍由全局 `Ctrl+O` 决定）。当前 edit 用这种（官方 edit 只有一个全文态，传不传无差别）。
- **强制** `{ ...options, expanded: true }`：跳过官方预览，一键完整展开。bash 和 write 用这种（`registerCollapsibleTool` 的 `forceFullExpansion` 参数），全局 `Ctrl+O` 对三工具彻底失效。

修改展开行为时，先确认是哪个层、哪种语义，再决定是否加 `expanded: true`。

### 3. renderShell 决定外框

| 工具 | 官方 renderShell | 折叠摘要外框 |
|---|---|---|
| edit | `self`（自己画框，无默认 Box） | 必须自己包 `CollapsedToolShell` |
| bash / write | 未设置（默认 `default`，自动带背景 Box） | Pi 自动提供，无需自己包 |

关键坑：**不要写死 `renderShell: "default"`**。之前试过，会让展开的 edit 多一层外框和边距，和 Pi 原生不一致。

`self` 工具折叠时无外框，用 `CollapsedToolShell`（`Box` 子类）包摘要：

- 实例存放在 `context.state.collapsedToolShell`。
- 跨 `renderCall` / `renderResult` 共享同一个外框（否则会出现两个独立外框、颜色不一致）。
- 背景色按状态切换：`toolPendingBg`（执行中）/ `toolSuccessBg`（成功）/ `toolErrorBg`（失败）。

### 4. lastComponent 必须清空

官方 renderer 复用 `context.lastComponent`（edit 的预览 Box、write 的 `WriteCallRenderComponent`、bash 的 `BashResultRenderComponent`）。代理调用时必须传：

```ts
{ ...context, lastComponent: undefined }
```

否则官方会把插件返回的组件当成自己的组件复用，导致状态错乱或类型错误。

### 5. 性能原则

- `LimitedLinesText`：按宽度缓存 wrap 结果，`invalidate()` 清除缓存。
- 折叠摘要只处理前几行文本，**绝不**对全量输出做 wrap 或逐行上色。
- 工具定义按 cwd 缓存（`editDefCache`、`writeDefCache` 等 Map）。
- 官方 bash 展开时每秒 `invalidate`（耗时计时），大幅展开大输出有持续成本。

## 常见修改点

| 想改什么 | 改哪里 |
|---|---|
| 默认折叠/展开状态 | compact 下全折叠；markdown 模式见 `modeDefaultExpanded`。手动钉选存在 `manualExpanded` |
| 折叠行数 | `MAX_COLLAPSED_COMMAND_LINES`（bash 命令）、`MAX_COLLAPSED_BASH_OUTPUT_LINES`（bash 输出）。`MAX_COLLAPSED_CONTENT_LINES` 同时影响 write 折叠，改它前先确认 |
| 折叠摘要内容 | `registerCollapsibleTool` 的 `collapsedCall` / `collapsedResult` 回调 |
| 展开行为 | `registerCollapsibleTool` 的 `forceFullExpansion` 参数（bash/write 为 true，edit 为 false） |
| 快捷键 | `pi.registerShortcut("ctrl+alt+x", ...)`，并在 `CTRL_CODE_TO_KEY` / `convertCtrlAltSequence` 中注册新键（Kitty 协议终端需要输入桥） |
| 新增工具覆盖 | 简单工具直接仿 bash 注册；想复用到官方切换逻辑用 `registerCollapsibleTool` |
| 折叠外框样式 | `CollapsedToolShell`（self 工具）或依赖默认 shell（default 工具） |

## 验证

- **类型检查**：`tsc --noEmit -p /tmp/minimal-mode-tsconfig.json`。注意：仓库无本地 node_modules，需用全局 Pi 包路径的临时 tsconfig（README 有说明）。
- **渲染对比**：临时脚本用 `ToolExecutionComponent`（Pi 内置组件）分别渲染插件工具和官方工具定义（`createEditToolDefinition(cwd)` 等），对比 `renderShell`、行数、关键内容。这是发现"多一层外框"这类问题的可靠方法。
- 修改后回归检查：展开输出应与官方一致；折叠输出应是紧凑摘要；快捷键切换正常。

## 本插件的当前行为速览

| 工具 | 默认 | Ctrl+Alt+快捷键 |
|---|---|---|
| bash | 折叠（1 行命令 + 1 行输出，计数后缀内联在行尾） | `Ctrl+Alt+B`：一键完整展开 / 收回 |
| edit | 折叠（`path` + 块数，单行）；markdown 模式下 Markdown 文件默认展开全文 | `Ctrl+Alt+E`：官方全文 ↔ 折叠摘要（带 shared Box 外框） |
| write | 折叠（`path` + 行数，单行）；markdown 模式下 Markdown 文件默认展开全文 | `Ctrl+Alt+W`：官方全文 ↔ 折叠摘要 |