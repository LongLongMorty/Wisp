# T-017 本地发布候选报告

实施版本：0.1.0-rc.1。验收已通过，T-017已勾选。验收状态和实际输出目录以 [t017-checks.json](evidence/t017-checks.json) 为准；只有 status=passed 时才表示该次候选通过。规格见 [candidate-v01.md](candidate-v01.md)，变更说明见 [changelog.md](../../docs/changelog.md)。

联网补验（本轮）：`node scripts/package-candidate.mjs --online` 十项检查全部通过（frozenAcceptance、sourceSnapshot、cleanInstall、check、tests、build、sdkExample、documentedSdkExample、reproducibleExtension、sourceAndAcceptanceUnchanged），`t017-checks.json status=passed`。首次补验时 `reproducibleExtension` 失败：WXT 将绝对构建根路径写入 `background.js`（`\0virtual:wxt-background-entrypoint?E:/Wisp/...`），导致不同目录构建字节不同。已在 `scripts/package-candidate.mjs` 比较与打包时把构建根路径规范化为 `<WISP_BUILD_ROOT>`（绝对路径属于环境信息，不是产品内容），未改动冻结的 `wxt.config.ts` 或 T-016 基线；规范化后工作区与隔离构建逐文件一致。

历史失败记录：离线安装曾报ENOTCACHED，缺少锁定的vite-7.1.7.tgz；显式联网重试曾报EACCES。本地允许联网后 `npm ci` 成功。失败报告保留在 evidence/t017-runs。

`node scripts/package-candidate.mjs` 创建全新隔离目录，生成固定条目顺序/时间的源码ZIP，并解压核对每个源码文件。使用既有npm缓存离线安装全部锁定依赖，不复制工作区node_modules；随后执行静态/类型检查、确定性测试、构建及两个SDK示例。扩展必须与已验收工作区逐文件相同，第二次隔离构建也须相同，才通过重现检查。

交付物在机器报告的output目录：源码ZIP、扩展ZIP、source-manifest.json、extension-manifest.json、SHA256SUMS和candidate-report.json。源码包里的规格、固定基线、验证器与当前证据可用于复核；不含旧证据归档，历史链接以原工作区为准。目录不在Git仓库内，因此使用内容摘要快照，不声明Git提交、标签或数字签名。

候选只在本地生成。没有新Chrome人工加载、实际模型调用、在线首次安装测试或公开发布。离线安装复用了已有缓存；没有缓存的使用者需要联网npm ci。相同字节输入的ZIP可重复生成，本次构建重现结论限于报告记录的Windows/Node/npm环境。

内部包和manifest版本保留已验收的0.1.0；rc.1是外部候选标识。原始T-013/T-014证据不改写；T-015/T-016因交付文档更新重新执行独立检查并归档前一版输出，旧严格T-014状态仍保留。

下一步 T-018 为2–3个真实Web应用的小范围试用，需要先明确目标站点和可执行任务；当前fixture成绩不能替代该阶段。
