# pi-tidy-tools

为 [Pi](https://github.com/earendil-works/pi-mono)（pi-coding-agent 的 TUI）打造的工具渲染精简扩展。它覆盖了 `bash`、`edit`、`write` 的渲染：默认呈现紧凑摘要，需要时切换为官方完整渲染。

> 只动显示层，不动执行层。三个工具的执行完全委托 Pi 官方实现，参数、行为、结果一字不差；插件只决定屏幕上画几行、用什么颜色。

[English](README.md)

## 默认视图

三个工具默认**全部折叠**：

| 工具 | 折叠摘要 | 展开 |
|---|---|---|
| `bash` | `$ command` 加一行输出预览，计数后缀 `... (N more lines)` 内联在行尾 | 完整输出 |
| `edit` | `edit 路径（N blocks）` + `applied +a -b` | Pi 官方渲染：路径、修改块数、实时 diff 预览、原生布局 |
| `write` | `write 路径（N lines）` + `done` | Pi 官方渲染：路径、行数、语法高亮内容 |

折叠摘要每槽单行：命令 1 行加输出 1 行（计数后缀内联在输出行尾）。

## 模式

| 模式 | 行为 |
|---|---|
| compact（默认） | 三工具全折叠 |
| markdown（`/tidy-markdown` 切换） | Markdown 文件（`.md`、`.mdx`、`.markdown`）的 `edit`/`write` 展开全文，其余照样折叠 |

切换模式会清空各工具的手动钉选并重渲染已有行。模式不持久化，重启后回到 compact。

## 快捷键

Mac 上按 `Command+Option+字母`（实测有效，对应插件注册的 `Ctrl+Alt+字母`；其他平台按 `Ctrl+Alt+字母`）：

| 快捷键（Mac） | 工具 | 切换内容 |
|---|---|---|
| `Command+Option+B` | `bash` | 折叠摘要 ↔ **一键完整输出** |
| `Command+Option+E` | `edit` | 官方渲染 ↔ 折叠摘要 |
| `Command+Option+W` | `write` | 官方渲染 ↔ 折叠摘要 |

每次切换会弹出通知提示当前状态；再按一次切回。

`bash` 和 `write` 展开时**一次按键直接显示完整输出**——跳过 Pi 内置预览（bash 的 5 行尾部预览、write 的 10 行预览）。`edit` 展开时使用 Pi **官方渲染**（它没有预览态）。全局 `Ctrl+O` 对这三个工具均无效。

## 命令

终端快捷键冲突或无法传入 Pi 时，使用这些命令：

| 命令 | 工具 |
|---|---|
| `/tidy-bash` | 切换 `bash` 输出 |
| `/tidy-edit` | 切换 `edit` 输出 |
| `/tidy-write` | 切换 `write` 输出 |
| `/tidy-markdown` | 切换 Markdown 模式（Markdown 文件的 edit/write 展开） |

## 使用方法

加载扩展：

```bash
pi -e ./tidy-tools.ts
```

或者作为 pi 包安装：

```bash
pi install @runminton/pi-tidy-tools
```

或者把 `tidy-tools.ts` 复制到 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目级），然后重启 Pi。

## 键盘协议说明（重要）

Pi 会在终端支持时协商 [Kitty 键盘协议](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)（CSI-u 序列）——Windows Terminal、WezTerm、Kitty、Ghostty 等都支持。在该协议下，`Ctrl+Alt+字母` 使用**控制字符码**编码：`Ctrl+Alt+E` 到达时是 `\x1b[5;3:1u`（5 = Ctrl+E 的控制字符，修饰位 = Alt）。而 Pi 的按键匹配层只识别 **ASCII 码形式**（`\x1b[101;7u`，即 ASCII `e` + Ctrl|Alt 修饰位）。如果终端发送前者、Pi 只认后者，快捷键就会无声失效——这就是不同终端行为差异的来源。

本扩展内置了一个小的输入桥：在按键到达 Pi 的匹配层**之前**，把这三个快捷键的序列改写成 Pi 能识别的形式。无论你的终端发送哪种编码都能工作：

- Kitty 控制字符形式（`\x1b[5;3:1u`）
- 传统形式（`ESC` + 控制字符，如 `\x1b\x05`）
- ASCII 码形式（`\x1b[101;7u`）

其他所有输入原样通过，不受影响。

如果你的快捷键仍然没反应，请依次检查：

1. **终端或输入法吞掉了按键。** 有些终端和输入法（例如中文输入法、Windows 的 Alt 菜单加速键）会在 Pi 收到按键之前把它拦截。换一个组合键或换一个终端试试。
2. **tmux / screen。** 如果 Pi 运行在 tmux 默认配置里，tmux 自己的按键处理可能干扰。
3. **自定义按键。** 绑定在 `tidy-tools.ts` 里通过 `pi.registerShortcut(...)` 注册——改那里的按键字符串即可重新绑定。Pi 内置的全局展开（`Ctrl+O`，即 `app.tools.expand`）则单独通过 `~/.pi/agent/keybindings.json` 配置。
4. **检查输入。** 执行 `/tidy-key-debug`，再按一次目标快捷键。Pi 会显示收到的字节和改写结果。若没有通知，终端或输入法在 Pi 收到按键前已拦截它。

## 更新日志

### 0.2.0 - 2026-09-05

- 默认三工具全折叠（edit/write 原默认展开）
- 新增 `/tidy-markdown`：Markdown 文件的 edit/write 自动展开全文，其余照样折叠；切模式清空手动钉选
- write 展开跳过官方 10 行预览，直接全文；全局 `Ctrl+O` 对三工具失效
- bash 折叠压成 2 行：计数后缀内联到输出行尾，失败输出（红色）同样单行
- 修 tab 宽度导致的窄终端折行；修 edit 双层外框多出的 padding

### 0.1.3

- 新增 `/tidy-bash`、`/tidy-edit`、`/tidy-write`、`/tidy-key-debug` 命令
- 修传统 `ESC` + 控制字符形式的快捷键归一化

## 开发

```bash
# 类型检查（通过仓库 tsconfig 解析 Pi 类型，依赖 node_modules/ 中指向全局安装的软链）
tsc --noEmit

# 冒烟测试与性能基准：用假扩展宿主渲染折叠/展开状态并测量每帧开销（见仓库测试说明）
```