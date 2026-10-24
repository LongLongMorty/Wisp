# T-002b正式工具链迁移报告

日期：2026-10-18。状态：已完成。依赖安装、类型检查和生产构建均已实际执行并通过，真实package-lock.json已生成。

## 已交付

- npm workspace继续使用；Node最低开发版本调整为22.18，支持直接执行不含转换型语法的协议TypeScript测试。
- protocol从手写ESM和.d.ts迁移为单一index.mts；tsc配置生成JS与声明，声明不再手动维护。
- 扩展迁移为WXT标准background.ts和React侧边栏，manifest从wxt.config.ts生成，移除旧静态manifest与复制构建。
- 直接依赖指定版本：WXT0.21.4、module-react1.2.2、Vite7.1.7、React18.3.1、TypeScript5.9.3。已按实际安装生成package-lock.json。扩展直接声明Vite7.1.7，但WXT实际构建解析到根目录Vite8.3.4，两者均记录在lockfile中；构建日志以实际8.3.4为准。
- 类型检查包含协议实现、协议消费类型断言、WXT生成类型和扩展TS/TSX。
- 构建后检查MV3 manifest、权限与入口资源；缺依赖或构建失败必须返回失败，不自动退回临时构建。

## 本轮验证

- npm install经可达镜像成功，安装154个包并执行`wxt prepare`，生成真实package-lock.json（lockfileVersion 3，255条包记录）；[安装证据](evidence/t002b-install.json)中保留早前EACCES失败记录，复跑未复现，按瞬态环境问题处理。
- 静态语法/JSON/WXT源码入口检查通过。
- 直接执行迁移后的TypeScript协议，原有10项行为测试全部通过。
- 正式类型检查通过：tsc编译协议并生成JS与声明；tsc校验协议消费类型断言；`wxt prepare`生成扩展类型；`tsc --noEmit`校验扩展TS/TSX。
- 生产构建通过：`wxt build --browser chrome`输出apps/extension/.output/chrome-mv3；[verify-build](../../scripts/verify-build.mjs)校验MV3 manifest、`minimum_chrome_version=125`、权限集合`sidePanel`、background与side_panel入口及全部本地资源存在。
- 汇总输出与源文件SHA-256见[t002b-checks.json](evidence/t002b-checks.json)：status=passed，lockfilePresent=true，四项检查全部通过。

## 复现

在可联网环境，从仓库根目录执行：

~~~powershell
npm install --cache .cache/npm --registry=https://registry.npmmirror.com
node scripts/validate-toolchain.mjs
~~~

验证脚本会重新生成[t002b-checks.json](evidence/t002b-checks.json)；只有四项检查全部通过且package-lock.json存在，status才为passed。若发现实际编译错误，应修复后重新生成报告，不能仅凭配置文件存在判定完成。本机使用npmmirror镜像完成安装。

## 完成门槛

已满足：验证报告全部通过且lockfile存在，勾选T-002b与父任务T-002。成功产物路径：apps/extension/.output/chrome-mv3。构建资源检查不等于浏览器交互验收，完整Agent能力仍由后续任务实现。

## 官方实现参考

- [WXT入口规则](https://wxt.dev/guide/essentials/entrypoints)
- [WXT TypeScript配置](https://wxt.dev/guide/essentials/config/typescript)
- [WXT React集成](https://wxt.dev/guide/essentials/frontend-frameworks)

本报告描述本次实际交付与限制，不追溯改变历史离线骨架的通过范围。
