# 团队规则、风险与反馈记忆

## 自定义规则

在 `local-overlay.yml` 的插件 `config` 下配置（沿用加载脚本产生的层级，不要使用另一套 plugins 配置）：

```yaml
        customRules:
          - name: 检查动态代码执行
            pattern: '\beval\('
            severity: critical
            category: security
            message: 确认输入来源和可执行内容，检查是否违反团队禁用 eval 的规则。
        learningMode: true
```

每条规则含 name、pattern、severity、category、message。最多 30 条，pattern 最长 256 字符。扫描当前批次的新增 after 行，不扫描已删除代码，不是完整 AST。每行不超过 20,000 字符、总扫描 1,000,000 字符，最多保留 100 条命中。正则运行于独立 worker，1.5 秒超时后终止；截断或超时写入覆盖限制并转人工。

命中仅是线索，包含精确位置和原文，报告单独分组。模型收到“重点核查”的提示，仍需第二轮源码证据才能确认问题。注释、字符串也可能命中；不可把 `db.update` 附近没找到 transaction 直接断言为缺少事务，更不能仅凭正则证明某接口没有鉴权。

## 风险排序

每条未处理意见分数为 1–10：security 基础 6、correctness 5、performance 4、maintainability 2；high 加 2、medium 加 1，confirmed 加 2，上限 10。可选建议最高 4，已解决或接受风险项为 0。总分取未处理项最大值，避免简单平均稀释高风险。

报告显示总分与高/中/低数量；8–10 为高、5–7 中、1–4 低。这是可解释的排序启发式，不是模型准确率、真实损失或 Meta 方案的复刻。未发现问题也不能审批合并。

- `request_changes`：存在非可选确认缺陷，且没有更优先的未完成/不确定条件。
- `needs_human_review`：未完成、过期、需要人工介入或存在待核查问题。
- `no_findings`：本轮未发现需处理的确认缺陷，仍须负责人判断覆盖与必要测试。

旧版会话没有 riskScore 字段也可读取；报告按当前规则计算，保存后补充字段。

## 人工反馈记忆

打开 `learningMode` 后，用需 Harness 批准的 `set_review_issue_status` 工具明确记录：

```json
{"sessionId":"RV-实际ID","issueId":"ISS-001","action":"false_positive","reason":"已检查调用方：同一资源的更新由队列串行执行，附实现位置……"}
```

action 支持 `false_positive`、`wont_fix`、`reopen`。前两者保存理由和原引用的代码片段，存入同仓库 `.dsh-review/learnings.json`；最多保留 100 条。`reopen` 清除该问题对应记忆。未开启学习时仍允许处置，但不会产生新的学习记录。

反馈只在业务上下文完全相同、文件相同且代码片段仍存在时加入提示词，最多带入最近 10 条。上下文或源码改变后不匹配的记录不会发送。它不是训练模型，也不直接自动隐藏发现，更不保证越用越准。模型自动判定的 false_positive 不会当成人工反馈收集。

理由也需要核实：JavaScript 单线程不能证明异步竞态不存在；“内部接口”不能自动证明输入已经校验；接受风险与认定误报是两个不同决定。
