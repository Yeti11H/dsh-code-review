# 真实 Web 操作演示

`assets/web-demo.mp4` 和 `assets/web-demo.gif` 记录官方 DeepSeek Harness `0.2.2-rc.1` 的真实浏览器页面，使用本次 0.2.0 实现和真实 DeepSeek API。长度 34 秒，视频画面 1440 × 960，GIF 1000 × 667。

操作依次为：打开 Web，新会话选择 DeepSeek Flash，输入需求与规则，模型调用 `start_review`，查看返回的代码位置、风险优先级与修复建议。浏览器通过 Playwright 操作并录制真实页面，不替换 DOM 中的报告、不注入脚本模型回复、不加速模型等待。字幕另加在画面下方，未遮挡原页面。片尾定格延长约 6.5 秒便于阅读。

案例是一个缺少 `input > 100` 校验的分页函数。明确规则要求 101 必须抛 RangeError，合法整数原样返回。插件返回 1 条已确认问题，原文可核对，处理优先级为 9/10；没有运行仓库测试，没有修改源码。风险分数是排序启发式，不是合并批准。

页面显示本次 Web 会话约 22.1K tokens，包含外层代理调用。这个数字不等于插件内层两次调用的独立账单；视频也不构成准确率或成本基准。模型环境使用官方 DeepSeek Flash 路由，选择模型、工具调用与结果都来自真实 Web 服务。

认证 token、API 密钥、浏览器地址栏均不出现在录制画面。字幕不是审查功能的一部分。本次未上传到 B站或 YouTube；可下载 MP4 后按平台流程上传。README 与 GitHub Release 提供可直接访问的演示。

旧文件 `assets/demo.gif` 仍保留，属于 0.1.1 的脚本模型排版动画，见 DEMO.md。不能把旧动画描述为真实模型录屏。

本次工具原始 Markdown 报告存于 `examples/web-demo/report.md`；JSON 会话在 `examples/web-demo/session.json`，仓库绝对路径已替换为占位说明。提示词、模型输出和证据保留，未附带认证信息。
