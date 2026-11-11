# CI 与命令行审查

`dsh-review` 是本插件提供的 CLI，不依赖不存在的 `dsh run-tool`。它复用 ReviewService，通过 DeepSeek Chat Completions 接口连接模型。Harness Web 插件仍复用 Harness 自己的模型服务。

```sh
npm install @ooohyg/dsh-code-review@0.2.1
# 在当前进程或 CI Secret 中设置 DEEPSEEK_API_KEY，不要写进命令历史或配置文件。
node node_modules/@ooohyg/dsh-code-review/scripts/ci-review.mjs \
  --cwd /path/to/repo \
  --target main \
  --requirement "新版本构建后发布索引" \
  --business-rules "旧版本不能覆盖新版本" \
  --output-json /path/out/report.json \
  --exit-code
```

`--target working` 检查未提交改动。填分支、提交或 `origin/main` 时，比较该引用与 HEAD 的 merge-base 到已提交 HEAD。CI 必须检出 PR head 提交并获取完整历史。

`--business-rules` 可重复传递，也可用英文逗号分隔；规则文本本身包含逗号时建议从 Web 输入。`--config` 指定受信任 JSON，可包含 `customRules`、`learningMode`、`maxCandidates`、`maxPromptChars`、`modelTimeoutMs` 和 `outOfScope`。不从 CI 配置运行测试命令。

其他参数：`--model` 默认 `deepseek-chat`，`--api-base` 默认 `https://api.deepseek.com`，`--max-tokens` 默认 3000、最大 8000。自定义 API 服务会收到代码与密钥，端点必须由安装者决定。模型名称与实际返回名称均保留在 modelUsage 中。网络代理可按 Node 24 的环境代理方式配置。

| 退出码 | 含义 |
|---|---|
| 0 | 本轮分析完成；没有触发所选阻断条件，不代表可以合并 |
| 1 | `--exit-code` 且存在非可选已确认缺陷，或 `--fail-on-needs-check` 且存在待核查问题 |
| 2 | 参数、凭证、网络、模型错误、取消、快照过期、覆盖不足或需要人工介入 |

JSON 包含会话、源码快照、模型输入输出、风险摘要与用量，旁边同时生成 Markdown。运行前失败（例如没有密钥）只输出错误和退出 2；已经建立会话后的模型失败会保留不完整报告。

GitHub Actions 示例：`examples/github-actions/ai-review.yml`。它是供读者复制的模板，本项目没有自动在 PR 上调用模型或评论。示例固定工具版本，将工具装到仓库外，不执行 PR 代码的生命周期脚本，只上传 artifact。fork PR 跳过；不要改成 `pull_request_target` 后检出不受信任代码。标题作为环境变量传递，避免拼进 shell。报告含源码，应控制访问与保留时间。同仓库 PR 也须由有权限使用模型凭证的人员提交。

本地测试覆盖 CLI 的真实子进程、测试 HTTP 服务、退出 0/1/2 和报告产物。GitHub 托管 runner 的验证结果另行记录，不能用本地通过代替。
