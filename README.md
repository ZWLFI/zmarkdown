<div align="center">

<img src="docs/hero-banner.png" alt="墨记 MoMark：写作时手边要有的一切，都在同一个窗口" width="100%" />

**中文** | [English](README.en.md)

# 墨记 MoMark

macOS 上的中文优先 Markdown 编辑器

<a href="https://github.com/lixiaoshuang79/momark/releases/latest"><img src="https://img.shields.io/badge/version-1.5.6-3D5A80" alt="version" /></a>
<img src="https://img.shields.io/badge/platform-macOS%20arm64%20%7C%20x64-4f5a69" alt="platform" />
<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7fa6cc" alt="license" /></a>
<a href="https://github.com/lixiaoshuang79/momark/stargazers"><img src="https://img.shields.io/github/stars/lixiaoshuang79/momark?style=social" alt="stars" /></a>

</div>

墨记是个人项目，一个人开发，目前只有 macOS 版。

写需求、报告或者长文的时候，手边的东西总是散的：资料开在浏览器里，参考文档在另一个窗口，图表得去别的工具里做，改稿意见混在聊天记录里。墨记想把这些收回一个窗口。右栏开网页，或者开另一篇文档；图表和能点的原型写成 `html` 块，在正文里直接跑；要让 AI 改稿，就在原文上逐条标注，攒齐了一次复制过去。

中文输入单独下过功夫。表格里打字、长段落软换行时上屏，不丢字，不跳光标。

## 哪里不一样

### HTML 块是活的

在文档里写一个 `html` 代码块，墨记显示的是渲染结果，不是源码。数据图表、能点的原型，直接长在正文里。需求文档里的原型，不用再另发一个链接。

**块里带 `<script>` 也能跑。** 整块放进 `sandbox="allow-scripts"` 的 iframe 里执行，脚本拿不到编辑器和文档，也碰不到本地文件。

<img src="docs/screenshots/data-report.png" alt="数据报告：交互图表直接渲染在文档里" width="760" />

<sub>数据报告。两张图表都写在文档的 html 块里，打开就是这样。</sub>

- 右下角有控制条：50%–200% 缩放，拖拽改视口大小。预览高度跟着内容收，范围 60–1200px。
- 调好的尺寸和缩放比例随文档存下，下次打开还是那样。
- HTML 和脚本本身就写在 `.md` 里。一个文件发出去，对方离线打开，照样渲染。
- 手上已经有现成的 `.html` 文件，直接粘进文档。会弹出一个气泡让你选：「内嵌到文档」把同目录的样式、脚本、图片一起内联，转成单个 `.md`；「上传图床并插入链接」走你配好的上传服务，文档里只留一条链接。
- 导出 HTML，块还是活的沙箱帧：双击打开能点、能切页签，右下角工具条照样缩放、拖拽。导出 PDF 或 Word，它变成一张等比定格的截图，和屏幕上看到的一致。

### 右栏：网页，或者另一篇文档

右侧面板有「网页」「文档」两种模式，一键切换。

网页模式是一个小浏览器。有自己的标签页和地址栏，几个页面来回切，能前进后退。⌘+ / ⌘- / ⌘0 缩放，0.25 到 3 倍，也可以直接「适应宽度」。查资料不用离开这个窗口。

<img src="docs/screenshots/prd-with-web.png" alt="左边写需求文档，右栏查网页资料" width="760" />

<sub>边写边查。左边是需求文档，右栏网页模式开着技术文档。</sub>

文档模式放另一篇 Markdown。把标签页拖出去，它就落进右栏，两篇并排编辑。滚动条放在中间的分隔带上，不压正文。

<img src="docs/screenshots/split-docs.png" alt="两篇文档左右并排" width="760" />

<sub>双文档分屏。笔记和数据报告并排，右栏里的图表照样渲染。</sub>

### 内容标注：改稿意见精确交给 AI

这个功能是给和 AI 一起改稿的人准备的。让 AI 改文章，难的往往不是改，是说清楚改哪儿。“第三章那段”“上面那个数”，它常常改错地方。

1. 选中一段话，点工具条上的「标注」，写一句修改意见。正文留下淡墨蓝高亮和序号，右栏「标注」面板管着每一条。
2. 一轮攒齐，一键复制。复制出来的是结构化文本：章节路径、行号、原文引用、所在段落、你的要求。整段粘给 AI Agent。
3. 复制过的条目标「已复制」。AI 改完文档，墨记自动比对，逐条提示「内容已变化」或「未变化」，核对完归档进历史。

批注存在应用数据目录里，**不往 `.md` 里写一个字**。交出去的文档是干净的。

反复要提的要求，比如“补上参考依据”，可以存成「常用语」胶囊。选中文字，点一下，标注就完成了。

### 中文输入

中文不是敲一个键出一个字。拼音先停在输入法的候选框里，选定之后才提交上屏。编辑器要是在这时候重绘，提交的字就可能丢，光标就可能跳。

墨记修了两处：

- 表格单元格里的输入法输入，整条链路修过一遍；
- 软换行的长段落里，输入法提交的内容完整保留。

写中文，不丢字，不跳光标。

界面内置十余种语言，中文排第一。中文界面是重新趟过的，不是套一份翻译了事。

## 其他能力

| 项       | 说明                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown | CommonMark、GitHub Flavored Markdown；KaTeX 公式；Mermaid、PlantUML 图表                                                                      |
| 编辑模式 | 源码模式、打字机模式、专注模式                                                                                                                |
| 编辑内核 | 块级文档模型。ot-json1 + ot-text-unicode 做增量更新，snabbdom 做视图层，marked 解析 Markdown，rxjs 管事件流                                   |
| 界面     | 主色墨蓝 `#3D5A80`，浅色、深色两套主题；非对称的侧栏动效；细线滚动条，滚动时才浮现                                                            |
| 导出     | HTML、PDF、Word                                                                                                                               |
| 日常     | 命令面板、全文搜索、图片上传（接你配好的上传服务）、应用内检查并下载更新                                                                      |
| 隔离     | 渲染进程完全沙箱化（`contextIsolation`、`sandbox: true`），Node 能力只经 `contextBridge` 白名单开放；数据目录独立存放，不和其他编辑器互相干扰 |

<img src="docs/screenshots/notes-biology.png" alt="图文笔记：表格与彩色插图混排" width="760" />

<sub>图文笔记。表格和彩色插图混排在同一篇里。</sub>

## 安装

从 [Releases](https://github.com/lixiaoshuang79/momark/releases/latest) 下载 dmg 或 zip。打开 dmg，把「墨记」拖进「应用程序」。

### 第一次打开被 macOS 拦下

墨记没有做 Apple 公证签名。第一次打开会弹出「Apple 无法验证“墨记”是否包含可能危害 Mac 安全或泄漏隐私的恶意软件」。这样放行：

1. 打开「系统设置 → 隐私与安全性」，在「安全性」一栏点 **仍要打开**；
2. 再打开一次墨记，在弹窗里选「打开」。

macOS 15 起，旧办法「右键 → 打开」已经失效，不用再试。

如果提示的是「已损坏，无法打开」，在终端执行：

```bash
xattr -cr /Applications/墨记.app
```

## 从源码构建

需要 Node.js ≥ 20.19（推荐 22）、pnpm ≥ 10。

```bash
pnpm install
pnpm build:mac          # 默认 arm64；Intel 芯片用 pnpm build:mac:x64
```

产物：

- 应用：`dist/mac-arm64/墨记.app`
- 安装包：`dist/momark-mac-arm64-1.5.6.dmg`、`dist/momark-mac-arm64-1.5.6.zip`

## 开发

```bash
pnpm dev                # 开发实例，渲染进程跑在 localhost:9333
```

技术栈：Electron 42 · Vue 3.5 · TypeScript（strict）· Pinia · electron-vite 5 · electron-builder 26，用 pnpm monorepo 组织。

## 项目结构

| 目录               | 说明                                 |
| ------------------ | ------------------------------------ |
| `packages/desktop` | Electron 桌面端（主进程 + 渲染进程） |
| `packages/muya`    | 块级编辑内核（TypeScript）           |
| `packages/muyajs`  | 旧编辑内核，退役中                   |
| `packages/website` | 官网 / 文档站                        |
| `docs/`            | 开发文档                             |

## 更新日志

当前版本 1.5.6，2026-10-13 发布。每个版本改了什么，见 [Releases](https://github.com/lixiaoshuang79/momark/releases)。

## License

[AGPL-3.0-only](LICENSE)。部分代码沿用 MIT 许可，范围见 [NOTICE.md](NOTICE.md)。

本页截图里的生物学插图来自 Wikimedia Commons（公有领域 / CC BY-SA 3.0），逐图来源与授权见 [docs/screenshots/figure-sources.txt](docs/screenshots/figure-sources.txt)。
