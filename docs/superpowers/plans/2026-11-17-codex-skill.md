# Codex Skill Implementation Plan

**Goal:** 当前 Codex 模型执行首次审查，离线脚本固定输入、校验和输出报告。
**Architecture:** 新增 Codex 编排层，复用 GitService / StorageService / evidence / ReportGenerator；不修改 DSH ReviewService。构建生成自包含 Skill runtime。
**Tech Stack:** TypeScript、Node >=24.9、Git、Codex Skill。
**Spec:** ../specs/2026-11-17-codex-skill-design.md

## Constraints / Review focus

不调用付费 API、不修改被审源码、不外部发布。覆盖错误或漏候选不能表现成完成；冻结输入变化后失效；删除文件用 before；Skill 包必须脱离源码运行；报告不虚构运行测试或独立模型核实。

## Tasks

- [x] 新增 `src/codex/review.ts`：prepare/scan/finish/context/status/cancel，使用已有存储锁及原子记录。响应绑定会话和快照，候选及覆盖校验，错误可重试。
- [x] 新增 `src/codex/cli.ts` 和 `scripts/codex-review.mjs`：严格参数、JSON 文件输入、机器可读摘要及未完成退出码。
- [x] 新增 `skills/dsh-code-review/SKILL.md`、schema reference、UI metadata 和 runner；`scripts/build-codex-skill.mjs` 复制必要 JS runtime。构建集成；本地安装到独立同名目录。
- [x] 新增 `tests/codex-skill.test.mjs` 验证真实 Git 输入、结构化导入、引用降级、候选/覆盖/绑定校验、过期、取消及自包含运行。
- [x] 更新 README 和 Codex 使用文档；运行新回归、全套测试、Skill validator、打包与安装检查，记录真实检查及未测范围。

各任务由当前会话执行；无需新增服务、通用代理框架或多 Agent 编排。
