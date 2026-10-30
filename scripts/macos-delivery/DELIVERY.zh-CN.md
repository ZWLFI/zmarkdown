# macOS 一键交付

源码现位于 `/Users/zwl/Documents/ChatGPT/zmarkdown/zmarkdown`。原任务目录仍保留历史报告、应用备份、1.6.4 发布附件及下载校验文件；它们不是新源码仓库。目标原来的空 Git 目录保存在相邻的 `zmarkdown-empty-init-backup-20261023`，没有覆盖文件。

当前依赖目录为指向 `/Users/zwl/Documents/Codex/2026-10-20/task/momark` 内 node_modules 的绝对符号链接，迁移后可继续使用，不要删除依赖来源。全新机器请先装 Node >=20.19、pnpm 10、Python 3、Xcode 命令行工具，再执行 `pnpm install --frozen-lockfile`；脚本会检查并明确报错，不会偷偷安装依赖或更改系统权限。GUI 回归需要已登录的 macOS 桌面。

从任何目录运行（路径包含空格也可）：

```bash
/Users/zwl/Documents/ChatGPT/zmarkdown/构建脚本/deliver-macos.command --help
/Users/zwl/Documents/ChatGPT/zmarkdown/构建脚本/deliver-macos.command --dry-run
/Users/zwl/Documents/ChatGPT/zmarkdown/构建脚本/deliver-macos.command
```

默认顺序：类型检查及构建 → 9 文件桌面定向单元测试及 3 文件编辑器选区单元测试 → arm64 打包 → 8 文件最终包 UI 回归。不是全仓库所有历史测试；测试未执行或失败不会计为通过，不会安装或发布。也可双击 `.command` 执行这个默认流程。

```bash
# 独立选择或恢复阶段（前置成功记录必须对应当前源码）
../构建脚本/deliver-macos.command --stage build test
../构建脚本/deliver-macos.command --stage package verify
../构建脚本/deliver-macos.command --stage install
# 显式完整流程，最后才向 GitHub 写入
../构建脚本/deliver-macos.command --all --notes /绝对路径/更新说明.md
../构建脚本/deliver-macos.command --from publish --notes /绝对路径/更新说明.md
```

日志、状态和产物：仓库 `temp/delivery/<版本>-<源码指纹>/`。每阶段显示编号、命令、耗时、结果；长命令实时输出并每 15 秒报告仍在运行。上传由 curl 显示实际传输进度，CI 输出状态；不伪造完成百分比。失败立即停止，保留记录；修复源文件后生成新的指纹目录，需要重新构建和测试。

安装到 `~/Applications/zmarkdown.app`，旧版同目录保留带时间戳的备份。程序仍运行时会停止并要求先保存、正常退出；不强杀、不自动保存用户文档。安装后按正常配置启动，检查进程存活并保留窗口。此自动启动检查不代替人工文档、窗口与设置验收；需要严格人工验收时先单独 `--stage install`，确认后再 `--stage publish`。

发布仅限 `ZWLFI/zmarkdown`，使用现有 `gh auth` 登录。必须先人工检查并提交本轮源码，工作树干净，根目录及桌面包版本一致；脚本不自动 `git add`、提交或升版本。源代码与测试、包、安装记录必须对应同一指纹；最终推送为 fast-forward，绝不 force push。新版本应先手动更新两处 package.json 并提交，再执行流程。**当前 1.6.4 已有独立发布资产；新脚本不并入或替换该历史版本。**

发布生成 arm64 ZIP、准确提交的源码 ZIP、SHA256SUMS；等待该提交 CI，通过后上传草稿，重新下载校验后才公开。同名附件只有大小与服务端 SHA256 都匹配才复用，冲突停止；公开版本不覆盖。网络中断时先查看 GitHub 草稿，保持源码与产物不变，重跑 `--stage publish` 续做缺失项。下载失败会保留日志；当前脚本重新下载未完成的单个附件，**没有自动分段续传**，慢网可先保留草稿并人工核验后处理，不能跳过哈希。

更新说明必须如实记载变化、验证范围、未签名未公证及剩余问题。1.6.4 曾出现一次未定位的编辑前脏标记；24 个加载/切换和4个开启自动保存的队列场景未复现，不代表根因已修复。新配置默认关闭自动保存。AGPL 和上游署名保持不变。

若需回退，先正常退出程序，再将带时间戳的旧应用恢复为 `zmarkdown.app`；不要删除用户数据或修改 Gatekeeper。脚本不保存 token，日志不打印凭据；测试只使用隔离样例。正常启动日志只保存在本机 `startup.log`，不要未经检查上传日志或截图。

最终目录：外层 zmarkdown 下分别为源码 zmarkdown/（含.git）和 构建脚本/（本说明、Python脚本、双击入口和模拟测试）。脚本通过自身位置定位相邻仓库，不要求从仓库目录启动。脚本实现从 1.6.5 起随源码在 scripts/macos-delivery/ 中版本管理；外层构建脚本目录保留兼容入口。不会改写 1.6.4 历史源码资产。
