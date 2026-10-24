# 离线工程验证报告

日期：2026-10-18。完成T-002a、T-003a，不代表原T-002、T-003或AC-01/10/11整体验收完成。本文环境阻塞小节是当时的记录；随后以相同探针复跑，GPU子进程故障未复现，T-001已完成，见[t001-report.md](t001-report.md)。

## 交付

- npm workspace定义与模块目录；未实现模块仅保留职责说明，无伪造可用API。
- 原生MV3模块化Background、侧边栏入口与复制构建；产物dist/extension。
- @wisp/protocol动作协议：目标、五类动作、四类条件、请求、错误码、严格解析和UTF-8载荷限制。
- .d.ts公开声明；暂未经过TypeScript编译器验证。
- 10项Node内置协议测试。

## 已执行检查

直接执行以下命令全部通过：

~~~powershell
node scripts/check.mjs
node --test packages/protocol/test/action.test.mjs
node scripts/build.mjs
~~~

测试结果10/10通过。原始输出和源文件SHA-256见[evidence/scaffold-checks.json](evidence/scaffold-checks.json)。构建产物仅为文件复制，未验证浏览器加载与交互。

## 环境阻塞

- Chrome复测仍出现GPU子进程异常退出；T-001未完成，原始结果已追加到[t001-attempts.json](evidence/t001-attempts.json)。
- npm注册表连接返回EACCES，离线缓存不足，未安装WXT/TypeScript/React/Vitest，未生成虚构依赖锁文件。
- 本机npm 10.3.0执行run命令时失败于子Shell初始化（Cannot read properties of undefined reading stdin）；直接Node入口可执行且已经验证。

## 下一步

恢复依赖下载和浏览器执行环境后，推进T-001与T-002b；纯协议的后续工作可继续补充消息信封、事件和观察schema，但不得据此放行未验证的浏览器控制能力。
