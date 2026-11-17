# 0.3.0 最终交付

日期：2026-11-17。

## 已完成

需求变更触发复查、逐轮业务依据、上下文反馈隔离、失败重试保护、人工核查交接与离线统计器均已实现。保留 DSH 轻量插件形态，没有新增 PRD 平台或连接器框架。

Luna 交付的材料索引、统计脚本和三张真实视频关键帧已复核。补齐统计结果中的模型/配置标识，修复输出中途失败与已有结果覆盖问题。历史评测交付目录已找回并生成脱敏归档，便于读者核对旧版局限。

## 验证

- 本地 Windows：68 项，67 通过，1 项因符号链接权限跳过；类型检查、构建及打包检查通过。
- [GitHub CI](https://github.com/Yeti11H/dsh-code-review/actions/runs/43998756581)：Ubuntu、Windows 各 68 项通过，0 失败、0 跳过。
- 独立 `.tgz` 安装、四个官方工具注册、更新后的 recheck 参数、CLI 帮助、安装包内统计器执行、隔离 profile 安装与配置组合均通过。
- README 与交付文档已在 Edge 渲染检查；新增截图逐张查看。仓库与归档发布文件未发现凭证，本机用户目录已从历史归档脱敏。

## 公开入口

- [代码仓库](https://github.com/Yeti11H/dsh-code-review)
- [v0.3.0 预发布与安装包](https://github.com/Yeti11H/dsh-code-review/releases/tag/v0.3.0)
- [完整验证记录](VALIDATION_0.3.0.md)
- [评测协议与统计用法](EVALUATION_PROTOCOL.md)
- [材料索引](EVALUATION_INVENTORY.md)

Release 提供插件 `.tgz`、源码 ZIP、历史脱敏记录 ZIP 与 SHA256SUMS.txt。[npm 包](https://www.npmjs.com/package/@ooohyg/dsh-code-review) 已同步为 0.3.0，官方 latest 指向 0.3.0，公共插件归档与 GitHub 安装包 SHA256 一致。可直接使用标准插件安装命令；第三方镜像若仍缓存旧版，请指定官方 registry。归档内旧文档的 npm 状态不再代表最新情况。

## 尚未形成实测结论的部分

本轮没有新真实模型请求；0.3.0 的 A/B/C 效果对照、真人核查耗时和新版真实模型复查录像尚未完成。历史归档属于 0.1.1，真实视频属于 0.2.0，不用作 0.3.0 模型质量证明。

下一项有价值的工作是固定新场景、人工确认标签、冻结配置与预算后做对照试验。未经过这些步骤，不宣传准确率提升，也不继续堆叠平台功能。社区收录与其他 DSH 版本兼容以各自核验为准。
