# 需求与证据驱动审查：探索评测协议

状态：离线统计器已实现并通过合成数据回归；真实 A/B/C 模型对照尚未执行。本文件约定数据格式与统计规则，不包含真实效果结果。

## 1. 对照与样本

三组：A 为普通模型只看代码；B 为同模型看代码及相同业务规则；C 为插件看相同材料。B/C 的代码、规则、文件与文本窗口应一致；C 若额外读取文件，必须记录并补控制，不能把上下文差异归因为核查流程收益。

拟建 6 个场景族：输入边界、角色权限、发布顺序、失败补偿约定、重试幂等、状态迁移/删除范围。每族设真实缺陷、合理实现、信息不足三种条件，共 18 条探索案例。保留至少一组代码完全相同而适用规则不同的案例。

按场景族划分开发/测试，相关修复和规则变体不得跨组。旧评测与公开样例已用于开发，不能当作未见保留集。真实历史来源与人工构造分列。

每条标签应有独立规则与反例/运行断言支撑。维护者确认答案后才冻结；Luna 不根据插件输出生成答案，不自行宣称专家盲审。

## 2. 离线统计文件约定

`scripts/evaluation/score.mjs` 只读取两份本地 JSON，不调用模型，不执行代码。

`runs.json` 是数组，每条唯一键为 `runId`，字段：

```json
{
  "runId": "example-001",
  "caseId": "boundary-strict",
  "arm": "plugin",
  "status": "completed",
  "modelRequested": "record-actual-name",
  "modelReturned": "record-actual-name",
  "configHash": "record-frozen-config",
  "codeHash": "record-snapshot",
  "contextHash": "record-input",
  "calls": 2,
  "inputTokens": 100,
  "outputTokens": 30,
  "elapsedMs": 1200
}
```

上例为格式示例，数字不是实测。arm 只接受 `code-only`、`with-requirements`、`plugin`；status 接受 `completed`、`failed`、`cancelled`、`budget_exceeded`。token 未返回时用 null，不假设零；calls 与 elapsedMs 非负。实际请求记录由后续执行器保留，本脚本不编造它们。

`adjudications.json` 是人工或维护者已确认的逐次评判数组，与 runs.json 的 runId 一一对应，字段：

```json
{
  "runId": "example-001",
  "knownDefects": 1,
  "detectedKnownDefects": 1,
  "confirmedClaims": 1,
  "validConfirmedClaims": 1,
  "needsCheckClaims": 0,
  "unsupportedConfirmations": 0,
  "notes": "维护者根据独立触发断言裁定"
}
```

这些计数必须由外部裁定提供；脚本不读取报告关键词来认定真伪。要求 detectedKnownDefects ≤ knownDefects、validConfirmedClaims ≤ confirmedClaims、unsupportedConfirmations ≤ confirmedClaims−validConfirmedClaims；计数为非负整数。同一已知缺陷被重复评论不能增加 detectedKnownDefects。

失败运行的这些质量计数一律为 null，notes 必须说明失败，不能将失败计为“零缺陷”。失败调用的已知资源量仍计入资源统计，未报告的 tokens 单独列未知数量。

## 2.1 离线统计器

运行命令：

```sh
node scripts/evaluation/score.mjs --runs runs.json --adjudications adjudications.json --output evaluation-result.json
```

脚本会输出指定 JSON 和同目录同文件名的 `.md` 报告，父目录需先创建。已有输入、已有输出、目录和链接均拒绝覆盖，请为每次统计选择新的输出名。校验通过后先写临时完整文件，再发布结果；文件系统失败时回收本次已写结果。进程被强制终止时，两份文件不具备跨文件事务保证。

`--synthetic` 只用于统计器自测数据，并在两份结果中标为“统计器测试数据”；真实结果不要带此参数。输入需通过本文件规定的字段、唯一性和计数关系校验；失败时以非零状态退出，不覆盖输入文件。JSON 的逐次记录保留模型请求名、返回名及配置/代码/上下文哈希；质量计数只来自裁定文件。

统计器只汇总外部裁定字段，不检查模型文本，也不运行样例代码。源数据与人工标签应留档；汇总报告不能替代它们。

## 3. 输出要求

每组分别报告：

- 运行总数、完成/失败/取消/预算耗尽数量和完成率。
- confirmed 精确率：validConfirmedClaims 合计 / confirmedClaims 合计。
- 已知缺陷发现率：detectedKnownDefects 合计 / knownDefects 合计。
- 质量分数只统计完成运行，显式列出样本量；不完整运行不悄悄移除。
- 分母为零输出 null，呈现时写 N/A，不显示 100%。
- needs_check 与 confirmed 分开统计；不把待核查当确认检出。
- unsupportedConfirmations 的数量；各场景逐题差异，不仅给均值。
- calls、已知输入/输出 tokens 合计、token 未知的运行数；延迟给原始值、中位数与最大值。金额没有账单依据就不报告。

拟定计算自测：某组两次完成运行各提供 confirmed=2/1、valid=1/1，则精确率为 2/3；known=1/1、detected=1/0，则发现率为 1/2。再加入一次失败，完成率为 2/3，质量指标仍基于两次完成，但必须显式显示失败一条。以上是测试预期，不是模型成绩。

## 4. 真实评测的额外约束

相同 provider/model、代码提交、提示词、输入可见范围、预算与重试条件先冻结。一次插件运行可能多次请求，因此审查运行数不等于 API 次数。请求失败、重试和超预算均保留记录，不重复运行到满意为止。

真实预算由用户另行授权。当前测试全部使用受控模型或本地 HTTP 服务，不可宣传为真实 DeepSeek 效果。用户核查耗时需要真人实际计时；没有数据就写未测。

质量标注、数据隔离、公平性审查与真实接口执行仍属高判断成本工作；Luna 的职责仅限按本协议整理和计算，不能独自改变这些约定。
