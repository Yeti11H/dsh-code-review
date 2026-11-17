# Codex Skill：当前会话模型审查

这是 GitHub 当前源码中的 Codex 入口；尚未包含在 npm 0.3.0 中。DSH 插件和原来的 DeepSeek CLI 保持原有用法。

## 与 DSH / CLI 的区别

| 入口 | 分析模型 | 目前提供的流程 |
|---|---|---|
| DSH 插件 | Harness 配置的模型服务 | 审查、增量复查、状态与人工处置 |
| 原 `dsh-review` CLI | 单独配置的 DeepSeek API | 非交互首次审查 |
| Codex Skill | 当前 Codex 会话的模型 | 首次审查、离线引用校验、报告、状态及取消 |

Skill 不启动子 Codex、不调用模型 API、不读取 API 密钥；模型使用遵循当前 Codex 服务的额度与数据处理设置，不能宣称本地推理或所有源码不上云。Codex 的扫描与核查在同一会话，不能当作独立 Agent 交叉验证。

## 从 GitHub 安装

需要 Node.js >=24.9、Git；被审仓库至少有一个提交。Windows PowerShell：

```powershell
git clone https://github.com/Yeti11H/dsh-code-review.git
cd dsh-code-review
node scripts/install-codex-skill.mjs
```

macOS/Linux：

```sh
git clone https://github.com/Yeti11H/dsh-code-review.git
cd dsh-code-review
node scripts/install-codex-skill.mjs
```

安装器会将自包含 Skill 复制到 Codex 技能目录；新开 Codex 对话后调用 `$dsh-code-review`。已存在同名目录时会停止，不覆盖本地文件。

## 从源码重新构建

需要 Node >=24.9、Git；被审仓库至少有一个提交。先在工具源码目录执行：

```text
npm ci
npm run build
npm run skill:install
```

默认安装到 `$CODEX_HOME/skills/dsh-code-review`，未设置 CODEX_HOME 时使用用户目录下 `.codex/skills/dsh-code-review`。安装器遇到已有同名目录会停止，避免覆盖本地修改。

仓库中的 `skills/dsh-code-review` 已包含运行所需模块与 MIT LICENSE，可直接复制到其他机器的技能目录。重建时 `npm run build` 会刷新其中的编译模块。

打开新的 Codex 对话后使用：

```text
使用 $dsh-code-review 审查当前仓库未提交的改动。
需求：分页只能在有效范围内切换。
业务规则：页码最小为 1，最大为 totalPages。
本次不涉及样式。只审查，不修改代码，不执行项目测试。
```

## 内部流程与记录

1. `prepare` 保存稳定 Git 快照、需求和上下文哈希，状态为未完成。
2. Codex 读取所有 diff 批次，通过 `context` 查阅冻结源码，形成候选问题。
3. `scan` 验证响应所属会话和输入版本、位置与覆盖声明，分配候选 ID。
4. Codex 对每个候选核查反证；`finish` 要求候选一一对应，调用原有引用校验并生成报告。
5. `status` 重新核对快照是否过期；`cancel` 记录取消。中断会保留待处理阶段，可通过原会话继续读取输入。

命令入口为安装目录的 `scripts/review.mjs`；源码调试也可运行 `node scripts/codex-review.mjs --help`。完整 JSON 格式在 Skill 的 `references/response-format.md`。输入、原始扫描/核查响应和最终结果保存在 `.dsh-review/codex/RV-*.json`，同名 `.md` 为报告。Codex 和 DSH 记录分开存储，不能互相复查。临时输入也应放在 `.dsh-review/` 内，避免影响被审快照；不要提交含源码的记录。该目录已被适配器的源码策略排除，但用户仍需防止误提交。

`working` 表示相对 HEAD 的工作区与暂存区综合改动，包括未跟踪文件；分支/提交表示 merge-base 到已提交 HEAD，忽略未提交改动。删除代码使用 before 侧。

## 不把校验成功等同于审查正确

- JSON 或候选缺失等错误会拒绝提交，保留待处理状态，允许修正后重交。
- 错误或缺失引用降级为待核查；缺少业务依据时，依赖业务的结论也降级。
- 未声明阅读的变更文件，以及源码策略排除的文件，进入遗漏记录，要求人工介入。模型自述阅读了文件不证明完整理解。
- `omissions` 专门记录未读代码或未核查候选，每一项都会要求人工介入。按请求不执行测试属于独立的运行限制，由报告单列，不应混入代码覆盖遗漏。
- 代码变化后会标记过期，必须重新 prepare；需求变化也需要新会话。首版不合并多次首次审查的发现，不提供三轮收敛控制。
- 适配器不执行项目命令；不会采信响应中的“测试已执行”。必要时用户可另行授权 Codex 运行测试，真实结果需单独说明。
- 退出 0 只说明该条命令被接受，prepare/scan 成功仍是未完成。退出 2 表示输入错误、过期、取消或需要人工介入。读取 phase、status 与 recommendation 判断后续动作；不能据此批准合并。
- 报告或快照未加密，源码过滤不是完整的密钥扫描，也不是 OS 隔离。宿主权限和人工合并决策仍需保留。

同仓库命令需串行执行，包括 context 读取；短时存储锁防止状态同时修改，不支持在同仓库并发调用 helper。

## 验证范围

回归测试使用真实临时 Git 仓库和构造的分析 JSON，验证流程、引用降级、遗漏、失败与快照变化，不证明模型发现缺陷的质量。独立复制的 Skill 运行测试不依赖 DSH 或 API 密钥。当前版本的真实质量对照、跨系统安装和多位用户实际使用仍需另行验证。

本次实际检查、独立宿主试用与限制见 [本地验证记录](CODEX_SKILL_VALIDATION.md)。
