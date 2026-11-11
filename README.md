# dsh-code-review

DeepSeek Harness 的证据驱动代码审查插件。读取真实 Git 改动，分两轮找问题、核对代码引用，保存报告并追踪修复。

**状态：0.1.0 试用版。** 适配并固定在 DeepSeek Harness `0.2.2-rc.1`、Cordis `4.1.0`。Harness 仍在快速迭代，升级后需要重新验证兼容性。项目未发布到 npm；请使用 GitHub Release 安装包或源码。

[下载安装包](https://github.com/Yeti11H/dsh-code-review/releases/tag/v0.1.0) · [报告问题](https://github.com/Yeti11H/dsh-code-review/issues) · [更新记录](CHANGELOG.md)

## 能做什么

- 审查暂存、未暂存及非忽略的未跟踪文件，或指定分支与 HEAD 的差异。
- 将需求、业务规则和不涉及范围一起交给模型。
- 第一轮找疑点，第二轮核查。程序逐字验证引用的文件、行号和原文。
- 输出已确认缺陷、待核查风险、可选建议、误报反证及覆盖范围。
- 保存原始快照、模型请求和响应、稳定的问题编号以及历轮记录。
- 修复后只扫描相对上一轮的变化，并复核受影响的原问题。
- 三个不同代码版本的审查仍未收敛时，提示人工介入。代码没变则不重复审查。
- 默认不改源码、不执行测试。测试与接受风险的操作经过 Harness 的批准机制。

“证据已核对”只说明引用确实来自快照，不保证模型对业务或执行路径的判断正确。`completed` 表示本轮分析完成，不表示批准合并。

## 环境

- Node.js **24.9.0 或更高版本**。
- Git，且待审仓库至少有一个提交。
- 在 DeepSeek Harness 中配置可用的模型。插件默认复用调用会话选择的 provider/model，不单独保存 API 密钥。
- Windows、macOS、Linux 均使用 Node 内置文件接口和不经过 shell 的 Git 调用。本次在 Windows 上验证。

## 本地安装与启动

### 使用交付的安装包

从 [v0.1.0 下载页](https://github.com/Yeti11H/dsh-code-review/releases/tag/v0.1.0) 下载 `dsh-code-review-0.1.0.tgz`。

在独立的工具目录中安装本地 `.tgz` 文件。路径请替换成下载位置：

```sh
mkdir review-tools
cd review-tools
npm init -y
npm install "D:/Downloads/dsh-code-review-0.1.0.tgz"
node node_modules/dsh-code-review/scripts/load.mjs "D:/code/my-project"
npx @deepseek-ai/dsh@0.2.2-rc.1 web --patch ./local-overlay.yml
```

此安装方式从 npm 下载 Harness 依赖，但插件本身来自本地安装包。启动后还需要在 Harness 中配置模型。

### 使用源码

解压源码并进入插件目录：

```sh
npm install
npm run build
```

为你的代码仓库生成加载配置。将路径换成真实 Git 仓库的绝对路径：

```sh
npm run overlay -- "D:/code/my-project"
```

macOS/Linux 可填写 `/Users/you/code/my-project`。命令生成 `local-overlay.yml`，里面会写入插件和仓库的绝对路径。

启动官方 Harness：

```sh
npx @deepseek-ai/dsh@0.2.2-rc.1 web --patch ./local-overlay.yml
```

选择已配置的模型，在聊天中输入：

> 请调用 start_review 审查当前仓库的未提交改动。需求：新版本构建完成后发布知识索引。业务规则：旧版本不能覆盖已经发布的新版本；索引未构建完整时不能参与检索。本次不涉及查询排序策略。不要修改源码，也不要运行测试。

工具返回会话 ID、问题数量、报告路径和 Markdown 报告。随后可以说：

> 我已经修复，请调用 recheck，sessionId 使用刚才返回的会话 ID，不执行测试。

查看历史：

> 请调用 check_review_status 列出本仓库的审查会话。

插件载入后注册四个模型可调用工具：`start_review`、`recheck`、`check_review_status`、`set_review_issue_status`。这些是工具名，不是独立终端命令；不存在示例计划里未经实现的 `dsh-code-review recheck` CLI。

## 工具参数

### start_review

```json
{
  "target": "unstaged",
  "requirement": "新版本构建完成后发布索引",
  "businessRules": ["旧版本不能覆盖已发布新版本"],
  "outOfScope": ["查询排序策略"]
}
```

`unstaged` 是沿用原方案的兼容名称，实际包含 **暂存＋未暂存＋非忽略的未跟踪文件**。`working` 是同义值。填 `main` 等分支名时，比较 `merge-base(main, HEAD)` 与已提交 HEAD；不会把脏工作区混入分支审查。

需求或业务规则可以留空，但依赖业务确认的结论会标成待核查，不由模型自行补齐。

### recheck

```json
{ "sessionId": "RV-实际返回的UUID", "executeTests": false }
```

没有代码变化时保留原结果，不增加轮次。变化包括相关上下文文件；并不限于原 PR 的几行。原问题若仍存在，保留稳定编号；已解决问题重新出现时，重新打开原编号。

复查扫描使用上一轮到当前快照的变化，代码证据引用当前快照。旧问题不能仅凭行号变化或代码消失就自动解决。存在未知影响时交给人工检查。

### check_review_status

```json
{ "sessionId": "RV-实际返回的UUID" }
```

省略 `sessionId` 列出会话。指定 ID 时同时检查代码是否已变化；已过期的报告会明确标记。

### set_review_issue_status

```json
{
  "sessionId": "RV-实际返回的UUID",
  "issueId": "ISS-001",
  "action": "wont_fix",
  "reason": "负责人明确接受此风险，原因是……"
}
```

`action` 取 `wont_fix` 或 `reopen`。通过 Harness 批准后记录原因，接受的风险仍在报告中可见。它只记录使用者的决定，不替代组织的负责人权限管理。不要让模型为了结束审查而自行接受风险。

## 可选测试验证

只有安装者在配置里指定测试命令，且使用者明确请求并通过 Harness 批准，才会执行。没有批准服务时拒绝执行。

在 `local-overlay.yml` 的 `config` 中增加：

```yaml
        testCommands:
          - file: node
            args: ["--test", "tests/index.test.js"]
        testTimeoutMs: 60000
```

然后请求 `recheck` 且 `executeTests: true`。命令通过参数数组启动，不接受模型生成的 shell 脚本。Windows 上不要直接配置 `npm.cmd`；可用 `node` 运行测试入口，或配置 Node 与 `npm-cli.js` 的完整路径。

测试会执行仓库代码，可能产生输出文件或副作用。报告记录真实命令、退出码、输出与对应快照；测试通过不会自动证明每条问题成立或解决。分支快照与工作区不一致时拒绝运行测试。测试更改源码会使报告过期。

## 配置与覆盖限制

可在 overlay 的 `config` 中设置：

| 配置 | 默认值 | 作用 |
|---|---:|---|
| `cwd` | 启动目录 | 安装者指定的仓库；子目录自动定位到 Git 根目录 |
| `provider` / `model` | 调用会话的选择 | 必须一起设置，或一起省略 |
| `maxChangedLines` | 500 | 每批最大改动行数；大文件也拆分 |
| `maxFileBytes` | 512000 | 单个源文件读取限制 |
| `maxSnapshotBytes` | 20000000 | 当前源码快照的字节预算 |
| `maxSourceFiles` | 2000 | 当前源码快照的文件数量预算 |
| `maxPromptChars` | 90000 | 单次请求字符上限，至少 4000 |
| `maxCandidates` | 20 | 每批疑点上限，超限明确报错 |
| `modelTimeoutMs` | 120000 | 单次模型调用超时 |
| `testTimeoutMs` | 60000 | 单条测试命令超时 |

二进制、符号链接、过大文件、依赖和生成目录、`.env` 与常见私钥文件默认排除。因读取限制遗漏的文件写入报告并转人工。文件名过滤不能识别所有硬编码秘密；使用者应按所在团队的数据访问规则配置 Harness 模型。

上下文通过相对导入、函数名文本搜索和有界代码窗口补充。**第一版没有完整 AST、跨语言调用图或自动证明功能。** 上下文文件存入快照，但并不意味着模型审查了每个文件的每一行。模型请求中不提供任何工具。

## 存储与审计

```text
你的仓库/
└── .dsh-review/
    ├── RV-<UUID>.json
    └── RV-<UUID>.md
```

JSON 包含源码快照、所有轮次、精确模型输入/输出和运行记录；Markdown 供人阅读。模型请求在发送前落盘，失败或取消也保留未完成状态。会话文件通过临时文件＋替换写入；仓库级互斥锁阻止并发复查覆盖。

这些文件包含代码，应在目标仓库的 `.gitignore` 中加入 `.dsh-review/`。插件会主动排除自己的输出，避免报告不断进入下一轮审查。插件不自动修改 `.gitignore`。

进程异常退出可能留下 `.dsh-review/.lock`。确认旧进程已经停止后再手动删除该空目录；不要在仍有审查运行时清锁。

## 开发、验证和发布

```sh
npm run typecheck
npm test
npm pack
```

测试使用真实临时 Git 仓库、官方 Cordis / tools / LLM 运行时及本地脚本模型。并发示例通过可控暂停点实际复现旧覆盖，并验证条件发布修复。

**脚本模型测试验证工程行为，不是 DeepSeek 检出率。** 本次没有调用真实付费模型，尚未评估线上准确率或成本。真实模型评测步骤见 [examples/live-evaluation.md](examples/live-evaluation.md)。

本次环境、检查结果和未完成的真实模型验收见 [docs/VALIDATION.md](docs/VALIDATION.md)。

`npm pack` 生成可安装的 `.tgz`。源码与试用安装包通过 [GitHub 仓库](https://github.com/Yeti11H/dsh-code-review) 和 [Release 页面](https://github.com/Yeti11H/dsh-code-review/releases) 提供。项目未发布到 npm，也未自动向社区发帖。

## 与原计划的调整

- 采用真实 `name/inject/apply`、`defineTool` 与 `ctx.llm.stream()`，不使用示意 API。
- 只声明实际所需 Harness peer 包；没有额外业务运行时依赖。Harness 自身仍有传递依赖，不宣称绝对零依赖。
- 无法通过引用校验的结论降级，而非宣称能够杜绝幻觉。
- 收敛检查包含最新一轮，无变化复查保留人工介入状态。
- 维护性问题和可选建议分开判断，报告分组不重复。
- `completed` 不等于允许合并；发布和风险决策仍由人负责。

## 官方接口依据

- [Your first plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)
- [Build a tool](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)
- [Tool authoring reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
- [LLM runtime](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm)

MIT License。审查方法参考文中讨论的两轮核查、业务上下文和复查收敛原则，未复制各团队的私有实现。
