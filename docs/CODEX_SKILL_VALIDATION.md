# Codex Skill 本地验证记录

日期：2026-11-17。状态：本地实现与安装完成；提交 Git 后推送 GitHub main。未发布 npm。npm latest 仍为已发布的 0.3.0，不含本次新功能。

## 实现边界

当前 Codex 会话承担扫描和候选核查，无独立模型调用、API 密钥、MCP 服务或 DSH 运行时依赖。离线脚本复用 GitService、引用校验、StorageService 和 ReportGenerator。为避免混用会话，Codex 记录保存在 `.dsh-review/codex/`，DSH 记录仍在原目录。

支持首次审查、状态、取消、编号冻结源码查询、业务输入绑定、候选完整性检查和 JSON/Markdown 报告。暂不支持 Codex 增量复查、人工处置记忆或三轮收敛控制。

## 实际执行

- `npm run build`：通过，生成 TypeScript 编译产物和自包含 Skill runtime。
- `npm test`：79 项，78 项通过、0 失败、1 项跳过；跳过项是原有符号链接测试，本机缺少创建权限。
- 随后自审修复报告写入顺序，新增“报告写失败不提交完成 JSON”的回归。最终 `node --test tests/codex-skill.test.mjs`：12 项全部通过，无跳过；最后这次没有重复执行整个旧回归集。原有 68 项中 67 项通过、1 项权限跳过。
- 测试涵盖候选遗漏/重复/错绑定、无效位置、引用降级、业务缺失、空发现、覆盖遗漏、源码变更、取消、中断恢复、before 证据、分支与工作区差异、报告写失败重试，以及脱离开发目录运行自包含 Skill。
- `quick_validate.py`：源码与本机安装目录均通过。系统 Python 无 PyYAML，依赖仅安装到被忽略的 `work/skill-validator-deps`，未修改全局 Python 环境。
- 安装到 `C:/Users/Lue/.codex/skills/dsh-code-review`，逐文件 SHA256 对比与构建目录一致。实际执行过独立 runner，没有 DeepSeek API key。
- `npm pack --dry-run --json --ignore-scripts`：包含 Skill、离线 runtime、LICENSE，未包含 work 样例与审查日志；没有执行 npm 发布。
- 使用说明经 Markdown 渲染并在 Edge headless 截图检查，表格、代码和中文可读，无明显横向溢出。截图保存在本机 work/codex-doc-preview。

## 宿主模型试用

使用独立 Codex 子 Agent，从安装目录读取 Skill，在两个隔离 Git 仓库执行 prepare、input、context、scan、finish、status。没有向执行者提供预期结论，没有执行被审代码，也没有调用额外模型 API。

- case-a：抽取分页递增函数，调用处仍保留 `Math.min(..., totalPages)`。初次扫描无候选。
- case-b：同类重构移除了返回值上界限制。发现 1 条 introduced/correctness 问题，后果严重性 medium；核查引用被程序接受，运行证据仍为 code_analysis_only。
- 初次两次试用将“按请求不执行测试”填入 omissions，两者均保守进入 needs_human，原生退出码均为 2。这是 Skill 说明歧义造成的使用问题，不记录为模型缺陷发现失败。已明确 omissions 只记录代码/候选覆盖遗漏，未执行测试单列。
- 修订说明后，对 case-a 新建会话重跑完整流程，候选与问题均为 0、omissions 为空，最终 done/completed/stale=false，finish 与 status 的原生退出码均为 0。首轮记录未覆盖或删除。
- 试用时并行 context 命令发生存储锁冲突，串行后成功；Skill 现已明确同仓库 helper 命令必须串行。

上述是公开构造样例的使用验证，不是独立测试集，也不构成准确率、节省人工时间或对其他审查工具的比较结论。引用校验通过不能证明推理正确。

## 交付

源码 Skill：`skills/dsh-code-review`。本机已安装的 Skill 可在新对话中以 `$dsh-code-review` 调用；没有验证桌面端技能菜单自动发现或其他机器的安装。

独立分享包：仓库同级 `dsh-code-review-codex-skill-2026-11-17.zip`，约 29 KB。包含所需运行模块，不包含 node_modules、模型密钥或审查样例记录。SHA256：`02178714A9E2065DC6719C5C5D637B1AEC9CAD43B910E2117296595F1680FC88`。

## 仍未验证

- 新版真实业务代码的固定样本对照、真人核查时间、审查质量或成本收益。
- macOS/Linux 上本次 Skill 的独立运行（已有 DSH 跨平台记录不能代替）。
- 上下文很长时的判断质量；批次和候选上限必须诚实记录遗漏。
- 不同 Codex 模型、会话压缩和中断后对 Skill 步骤的稳定遵循。
- 官方在线 Skill 文档本次请求返回 403；实现依据本机 skill-creator 规范，并通过本地格式校验和执行验证。
