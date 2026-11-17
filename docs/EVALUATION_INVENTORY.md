# 评测材料索引

盘点日期：2026-11-16。此索引只说明仓库现有文件和文档记录，不把公开样例改称保留集，也不补造缺失的原始记录。

## 案例与数据

| 材料 | 内容与标签依据 | 数据性质 | 模型调用与版本 | 缺失项 / 使用限制 |
|---|---|---|---|---|
| `examples/test-cases/case-1-race-condition/before.ts`、`after.ts`、`expected-findings.json` | `publish(..., false)` 与条件发布对比；预期触发序列、业务规则和确定性测试说明写在 expected 文件 | 仓库维护的回归案例；预期文件明确说模型检出率仍需另测 | 文件本身没有真实模型响应或请求记录；不能据此推算命中率 | 没有独立裁定记录；已作为开发材料，不能充当未见保留样本 |
| `examples/test-cases/case-2-false-positive/code.ts`、`expected-findings.json` | 分页实现已检查整数、上下界；预期是不要重复建议相同校验 | 仓库维护的反例/回归夹具 | 没有附带真实模型调用记录 | 没有独立裁定记录；不能计入真实模型误报率 |
| `examples/test-cases/case-3-missing-context/code.ts`、`expected-findings.json` | `active ?? previous`；文档指出没有业务约定时不能断言回退错误 | 仓库维护的信息不足案例 | 没有附带真实模型调用记录 | 没有独立裁定记录；不能计入真实模型误报率 |
| `examples/test-cases/case-4-recheck-convergence/round-1.ts` 至 `round-3.ts`、`expected-behavior.md` | 固定回归复查轮次和停止状态；文档明确说变更多字段本身不是缺陷 | 工程状态机案例 | 由项目脚本模型适配器检查；不是 DeepSeek/真实 Harness 评测 | 无真实模型质量标签；不能用于缺陷发现率 |
| `examples/web-demo/session.json`、`report.md` | 分页上界问题的真实 Web 会话及插件报告，仓库报告记录 1 条确认意见 | 真实演示记录；单个案例，非独立保留集 | `docs/WEB_DEMO.md` 记录 Harness `0.2.2-rc.1`、本次 `0.2.0` 实现与 DeepSeek Flash 路由；视频为 34 秒 | 没有独立裁定人，也不是准确率样本；会话模型文字不能自行证明标签真实 |
| `docs/LIVE_EVALUATION.md` | 归档 `0.1.1` 评测的摘要、问题和用量表 | 历史真实接口评测文档 | 记录日期 2026-11-11、请求 `deepseek-chat`、成功返回 `deepseek-flash`、源码提交 `e4da774`；摘要说三个独立案例及修复复查 | 原始交付目录已找回，59 个记录文件整理为 Release 历史脱敏归档；不复制进源码和 npm 包。旧版本小样本只能作为历史背景 |
| `examples/live-evaluation.md` | 如何创建案例、执行审查和复查的步骤与空结果表 | 操作说明与待填模板 | 不含执行结果 | 空表不能被当作零缺陷或零成本实测 |

## 演示文件

- `assets/web-demo.mp4`：本地文件存在，34 秒，1440 × 960；与 `docs/WEB_DEMO.md` 的版本、模型路由和操作描述一致。
- `assets/web-demo.gif`：同一真实 Web 演示的 GIF 预览；README 链接指向该文件。
- `assets/demo.gif`：旧 0.1.1 脚本模型排版动画，`docs/DEMO.md` 说明其性质。它不是模型审查录屏，不能与真实 Web 视频混为一谈。
- `assets/demo-preview.png`、`assets/web-demo-opening.png`、`assets/web-demo-preview.png`：仓库已有预览图。三张新关键帧见 `assets/web-demo-frame-03s.png`、`assets/web-demo-frame-15s.png`、`assets/web-demo-frame-28s.png`，对应源视频时间点，不代表额外一次审查。

## 结果边界与空缺

- 本仓库有历史真实模型评测摘要和一段真实 Harness 演示，也有多个确定性工程案例；三者性质不同，不能合并计算成一个准确率。
- 初次索引时没有在源码仓库找到完整原始历史包；最终复核在外部交付目录找回，现见 [历史归档](https://github.com/Yeti11H/dsh-code-review/releases/download/v0.3.0/historical-evaluation-0.1.1-2026-11-11.zip)。归档带路径脱敏说明和 SHA256 清单。
- 仍没有冻结的独立保留集、统一逐次裁定 JSON，或 0.3.0 的真实模型 A/B/C 对照记录。
- docs/EVALUATION_RESULTS.md 在本次盘点前不存在。本索引不创建质量分数，也不替历史模型意见追加人工真值标签。
- 新版离线统计器的输入格式由 `docs/EVALUATION_PROTOCOL.md` 定义；要形成正式评测结果，需先由维护者独立裁定每条模型输出，再运行统计器。

## 逐项核对路径

- `README.md`
- `docs/WEB_DEMO.md`
- `docs/DEMO.md`
- `docs/LIVE_EVALUATION.md`
- `docs/EVALUATION_PROTOCOL.md`
- `examples/test-cases/case-1-race-condition/before.ts`
- `examples/test-cases/case-1-race-condition/after.ts`
- `examples/test-cases/case-1-race-condition/expected-findings.json`
- `examples/test-cases/case-2-false-positive/code.ts`
- `examples/test-cases/case-2-false-positive/expected-findings.json`
- `examples/test-cases/case-3-missing-context/code.ts`
- `examples/test-cases/case-3-missing-context/expected-findings.json`
- `examples/test-cases/case-4-recheck-convergence/round-1.ts`
- `examples/test-cases/case-4-recheck-convergence/round-2.ts`
- `examples/test-cases/case-4-recheck-convergence/round-3.ts`
- `examples/test-cases/case-4-recheck-convergence/expected-behavior.md`
- `examples/live-evaluation.md`
- `examples/web-demo/session.json`
- `examples/web-demo/report.md`
- `assets/web-demo.mp4`
- `assets/web-demo.gif`
- `assets/demo.gif`
- `assets/demo-preview.png`
- `assets/web-demo-opening.png`
- `assets/web-demo-preview.png`
- `assets/web-demo-frame-03s.png`
- `assets/web-demo-frame-15s.png`
- `assets/web-demo-frame-28s.png`

