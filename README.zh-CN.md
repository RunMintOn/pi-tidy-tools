# pi-tidy-tools

为 [Pi](https://github.com/earendil-works/pi-mono)（pi-coding-agent 的 TUI）打造的工具渲染精简扩展。它覆盖了 `bash`、`edit`、`write` 的渲染：默认呈现紧凑摘要，需要时切换为官方完整渲染。

[English](README.md)

## 默认视图

每个工具启动时处于两种状态之一：

| 工具 | 默认状态 | 显示内容 |
|---|---|---|
| `bash` | **折叠** | `$ command`、一行输出预览、有更多输出时加 `... (N more lines)` 计数行 |
| `edit` | **展开** | Pi 官方渲染：路径、修改块数、实时 diff 预览、原生布局 |
| `write` | **展开** | Pi 官方渲染：路径、行数、语法高亮内容 |

折叠摘要为单行样式（bash 额外保留一行输出预览 + 一行计数）。

## 快捷键

| 快捷键 | 工具 | 切换内容 |
|---|---|---|
| `Ctrl+Alt+B` | `bash` | 折叠摘要 ↔ **一键完整输出** |
| `Ctrl+Alt+E` | `edit` | 官方渲染 ↔ 折叠摘要 |
| `Ctrl+Alt+W` | `write` | 官方渲染 ↔ 折叠摘要 |

每次切换会弹出通知提示当前状态；再按一次切回。

`bash` 展开时**一次按键直接显示完整输出**——跳过 Pi 内置的 5 行尾部预览。`edit` 和 `write` 展开时使用 Pi **官方默认渲染**：委托给官方渲染器，内容本身是否进一步展开仍由全局 `Ctrl+O` 控制，与不装本扩展时完全一致。只有 `bash` 在展开状态下不受 `Ctrl+O` 影响。

## 命令

终端快捷键冲突或无法传入 Pi 时，使用这些命令：

| 命令 | 工具 |
|---|---|
| `/tidy-bash` | 切换 `bash` 输出 |
| `/tidy-edit` | 切换 `edit` 输出 |
| `/tidy-write` | 切换 `write` 输出 |

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

## 开发

```bash
# 类型检查（通过仓库 tsconfig 解析 Pi 类型，依赖 node_modules/ 中指向全局安装的软链）
tsc --noEmit

# 冒烟测试与性能基准：用假扩展宿主渲染折叠/展开状态并测量每帧开销（见仓库测试说明）
```