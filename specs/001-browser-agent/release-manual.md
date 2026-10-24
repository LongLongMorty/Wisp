# T-014 发布人工检查

必须由能直接操作Chrome的真实检查者完成，使用当前未改动的 `apps/extension/.output/chrome-mv3` 构建。不要从T-012复制检查结果，不要用普通扩展tab冒充原生侧边栏。

先运行 `npm run build`，加载扩展，按[侧边栏人工步骤](panel-manual.md)启动本地站点与 `node apps/extension/test/model-fixture.mjs`。这里可使用固定fixture模型检查UI；它不能代替T-014实际模型15次任务。请记录Chrome版本和每项实际观察。

| ID | 需要实际检查 |
| --- | --- |
| confirmation | 在原生面板运行PANEL_CONFIRM：确认卡片展示目标站点、具体动作/参数、有效期；拒绝无副作用，重试批准只执行一次。站点或字段变化后旧批准不可执行。 |
| pauseResume | PANEL_WAIT接管后可手动操作网页；恢复前重新观察；关闭/重开面板保持暂停。未知结果必须先核对或明确确认，不能直接重发。可结合本轮故障报告核对不确定状态提示。 |
| capability | Chrome内部页/隐身页不能授权执行；遇到跨域iframe、支付/密码/验证码等明确报错或请求接管，不显示成功或自动绕过。 |
| dataFlow | 面板清楚说明过滤后的页面信息将发送到所选模型；密钥只在扩展storage.session，保存后输入框清空，清除配置和删除终态历史有效。PANEL_HANG点击停止，用屏幕录制或时间标记核对面板1秒内显示停止，迟到结果不继续动作。记录观察/测量方法及结果。 |

完成后在本地新建JSON观察记录，例如 `.cache/t014-manual-notes.json`。四个属性名为confirmation、pauseResume、capability、dataFlow，每个值填写亲自观察到的结果（含必要版本、时限测量、边界），不要填写模板“通过”，不要包含密钥或个人数据。

```powershell
node scripts/record-release-manual.mjs --passed=confirmation,pauseResume,capability,dataFlow --reviewer=local-user --notes=.cache/t014-manual-notes.json
node scripts/validate-toolchain.mjs t014
```

录入工具只记录检查者声明，不会代替检查。没有完成时不传passed，仅生成not-run。人工记录绑定当前源码、测试脚本及生产构建；任何变化后重新核对。若发现问题，保留失败说明并修复/复验，不手改JSON制造通过。
