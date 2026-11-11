# dsh-code-review 0.2.1 · 标准插件安装修复

旧版需要手动生成 overlay，npm 可安装但未声明标准 Harness bundle。本版补齐一键安装入口：

```sh
dsh plugin --profile web add @ooohyg/dsh-code-review
```

- 包含 bundle 声明、cordis.patch.yml、图标和精确的 DSH 兼容版本。
- 默认按当前会话工作目录审查；安装者指定的 cwd 优先。
- 补齐 README 安装、卸载、云模型数据路径及社区收录边界说明。
- 类型检查、本地完整测试、隔离 profile 官方安装与配置组合检查通过；独立安装注册四个工具通过。详见 docs/INSTALLATION_0.2.1.md。

适配 Harness Web 0.2.2-rc.1，Node >=24.9.0；桌面版与其他 DSH 版本未验证。已使用旧 overlay 的用户请选一种加载方式，避免重复注册。

npm 发布和社区目录收录为独立步骤；本次发布不代表已被目录核验。源码、安装包与校验文件见附件。真实演示沿用 0.2.0 录制结果，未宣称本次重新评测模型准确率。
