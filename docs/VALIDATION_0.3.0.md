# 0.3.0 交付与验证

日期：2026-11-17。适配 Harness Web 0.2.2-rc.1，Node >=24.9.0。

## 本次交付

- 需求或业务规则变更时，即使代码不变也重新分析；逐轮保存业务依据。
- 新规则下重新核对接受风险，失败重试保留历史依据，旧反馈不跨上下文复用。
- 报告提供摘要、严重性与核查结论、执行记录、未覆盖范围与人工交接。
- 离线统计器从已有记录和外部裁定汇总结果，保留模型及配置标识；失败、取消、预算耗尽和未知 tokens 不被隐藏。
- 补充材料索引与真实视频关键帧；提供 0.1.1 历史评测脱敏归档。

## 验证进度

- Windows 本地完整回归：68 项，67 通过，0 失败，1 项因本机符号链接创建权限跳过。统计器 10 项回归包括失败不留下半份结果、拒绝覆盖、模型/配置标识保留、未知用量及空分母。
- 类型检查、构建与 pack 检查通过。Release 归档含实际编译产物、bundle 和离线统计脚本。
- 独立工具目录从本地 0.3.0 `.tgz` 安装成功；官方 Cordis/tools/LLM runtime 注册四个工具，`recheck` 参数包含 `reviewContext`；CLI help 可运行。
- 隔离 DSH_HOME 使用官方 `dsh plugin --profile web add <本地0.3.0归档> --ignore-scripts` 成功。官方 profile loader 识别 0.3.0 bundle，skippedBundles 为零。
- GitHub 当前代码的 Ubuntu/Windows 托管检查在发布前核对；结果链接随后补充。上述本地检查不能代替跨平台结果。

## 获取新版

[GitHub v0.3.0 预发布](https://github.com/Yeti11H/dsh-code-review/releases/tag/v0.3.0) 提供安装归档、源码与 SHA256 校验文件。npm latest 仍为 0.2.1；新包未发布到 npm。新版需安装 Release 的 `.tgz` 或自行构建源码。

官方 Harness 的插件安装命令支持本地归档路径；隔离 profile 验证方法沿用 INSTALLATION_0.2.1.md。使用手动 overlay 时，安装 `.tgz` 后运行包内 `scripts/load.mjs` 并启动指定 Harness 版本。不要同时使用 profile 和 overlay 重复加载插件。

## 评测与限制

- 本轮工程测试使用脚本适配器和本地 HTTP 测试服务；没有新付费模型调用。
- 0.3.0 尚无相同模型、相同代码与规则的 A/B/C 真实对照，不能宣称准确率、误报率或审查耗时改善。
- 0.1.1 归档保留失败和恢复记录。绝对目录脱敏后部分归档脚本需本地重新配置；不能把历史响应当作新版执行。
- 34 秒真实视频沿用 0.2.0；截图没有新增审查，也不覆盖本次上下文变更功能。
- 桌面版、其他 Harness 版本、真人核查耗时与风险分数的概率校准未验证。
- 社区目录收录由独立社区决定，不把 GitHub 发布当作已收录。

## 使用统计器

从源码根目录运行：

```sh
node scripts/evaluation/score.mjs --runs runs.json --adjudications adjudications.json --output result.json
```

先创建输出父目录，并使用未存在的结果名。用合成 fixture 检查时加 `--synthetic`，不要把该输出当作模型成绩。字段与公式见 EVALUATION_PROTOCOL.md。
