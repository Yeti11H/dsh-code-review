# dsh-code-review 0.2.0 · CI、团队规则与真实 Web 演示

这次把插件接入自动流程，并补上团队定制与真实操作展示。

- 新增 `dsh-review` 非交互 CLI，复用审查核心，输出 JSON/Markdown，支持退出码与环境变量凭证。
- 新增 0–10 风险处理优先级；总分保留最高未处理项，不替代合并判断。
- 新增团队正则规则：只匹配新增行，隔离 worker 超时终止，命中仍需语义核查。
- 增加显式人工反馈记忆，按同仓库、业务上下文与当前原文匹配，不自动屏蔽风险。
- README 先说明价值、适用场景与数据流，并公开真实模型评测暴露的局限。
- 录制 34 秒官方 Web + 真实 DeepSeek 操作视频，包含模型选择、工具调用与报告。

视频：`dsh-code-review-web-demo.mp4`；动图：`dsh-code-review-web-demo.gif`；源码包：`dsh-code-review-source-0.2.0.zip`；本地插件包：`ooohyg-dsh-code-review-0.2.0.tgz`。

安装：下载安装包后运行 `npm install <本地tgz路径>`，然后按 README 生成 overlay 启动 Harness。npm 注册表更新状态以包页面和实际安装验证为准。

类型检查通过；GitHub 托管 Ubuntu 与 Windows 各 45 项测试全部通过。新增 CI、规则、反馈与风险测试通过，安装包独立安装通过。完整检查及真实运行范围见 VALIDATION_0.2.0.md。首次真实小样本评测仍暴露推理过度与复查噪声，本版不承诺稳定准确率。
