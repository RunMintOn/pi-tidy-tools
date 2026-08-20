# pi-clean-tool-render

为 [Pi](https://github.com/earendil-works/pi-mono)（pi-coding-agent 的 TUI）打造的精简工具渲染扩展。它覆盖了 `bash`、`edit`、`write` 的渲染方式：默认折叠成一行小摘要，需要时按工具单独展开，让工具输出不打扰你。

[English](README.md)

## 特性

- **默认折叠** —— 每个工具只显示简短摘要（最多 3 行），省略的内容用 `...` 标记。
- **按工具单独展开** —— 只展开你关心的那一个工具，每个工具一个快捷键：

  | 快捷键 | 工具 |
  |---|---|
  | `Ctrl+Alt+E` | `edit` |
  | `Ctrl+Alt+W` | `write` |
  | `Ctrl+Alt+B` | `bash` |

- **与全局 `Ctrl+O` 互不影响** —— Pi 内置的"全部展开"开关不会影响这三个工具。每个工具只有两种状态：折叠摘要 ↔ 官方完整渲染。
- **展开时使用官方渲染器** —— 完整展开的内容委托给 Pi 内置渲染器，完整的 diff 预览和语法高亮依然可用。
- **性能好** —— 渲染结果有缓存，且只处理预览行的文本：2000 行输出每帧约 13 微秒，修复前是约 3 毫秒。

## 使用方法

加载扩展：

```bash
pi -e ./tidy-tools.ts
```

或者作为 pi 包安装：

```bash
pi install pi-tidy-tools
```

或者把 `tidy-tools.ts` 复制到 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目级），然后重启 Pi。

之后用 `Ctrl+Alt+E` / `Ctrl+Alt+W` / `Ctrl+Alt+B` 切换对应工具的展开状态。按下时会弹通知提示当前状态；再按一次收起。

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

## 开发

```bash
# 类型检查（通过仓库 tsconfig 解析 Pi 类型，依赖 node_modules/ 中指向全局安装的软链）
tsc --noEmit

# 冒烟测试与性能基准：用假扩展宿主渲染折叠/展开状态并测量每帧开销（见仓库测试说明）
```