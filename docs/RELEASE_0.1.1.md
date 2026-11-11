# dsh-code-review 0.1.1 · npm 分发与流程演示

本次更新添加 npm 作用域包与 GIF，核心审查逻辑沿用 0.1.0。

## 安装

```sh
npm install @ooohyg/dsh-code-review@0.1.1
node node_modules/@ooohyg/dsh-code-review/scripts/load.mjs "D:/code/my-project"
npx @deepseek-ai/dsh@0.2.2-rc.1 web --patch ./local-overlay.yml
```

替换示例仓库路径，并在 Harness 中配置模型。需要 Node.js 24.9.0 或更高版本。无作用域的 `dsh-code-review` 为其他作者的包。

## 下载

- `ooohyg-dsh-code-review-0.1.1.tgz`：可离线取得的插件包，安装依赖仍需要联网。
- `dsh-code-review-source-0.1.1.zip`：源码、测试、文档、编译产物与 GIF。
- `dsh-code-review-demo.gif`：25.8 秒流程演示，1200 × 760。
- `SHA256SUMS-0.1.1.txt`：上述文件的 SHA-256 校验值。

GIF 使用本地脚本模型，回放实际执行插件核心后产生的审查与复查结果。并发案例另行运行真实代码；动画不是界面录屏，不代表真实 DeepSeek 的检出率或延迟。数据来源见 `docs/DEMO.md`。

上一版本的 39 项测试通过，1 项因 Windows 权限跳过。本次未修改核心实现，已补验类型检查、作用域包构建和演示执行。真实模型准确率与费用仍待评测。
