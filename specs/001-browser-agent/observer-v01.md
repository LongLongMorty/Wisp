# T-005 只读页面观察规格

目标：实现不依赖模型的Chrome页面观察模块，输出既有Observation协议。只读observe/inspect/dispose，不实现动作、站点授权UI或完整BrowserAdapter。

## 结构

packages/browser-chrome包含三个可测试原语：节点身份注册表、敏感信息清洗器、可在isolated world安装的DOM观察器。Chrome观察桥接收由受信任宿主绑定tab的CDP transport及明确allowedOrigins；每次观察和检查前验证主frame及origin。不得接受模型提供的JS或选择器。

观察器初始化只调用固定预置代码。安装函数及其两个纯依赖作为函数源码注入，由编译后的库生成，不拼接页面文本或模型代码。默认不向页面写属性；引用和DOM对象只在isolated world私有注册表中保存。

## 引用生命周期

Target的documentId/frameId/observationId/ref必须同时有效。保留最近8次完整观察作用域，最多2048条强引用；过期作用域或导航后的引用返回STALE_TARGET。同一节点在保留期内沿用ref，无关DOM变化不全量失效。MutationObserver跟踪document及open ShadowRoot移除记录；移除后重新插入同一对象也必须发新ref，绝不把旧ref模糊绑定到新节点。dispose释放监听与引用。

resolve只保证身份有效；可见、禁用、遮挡、动画等动作前断言由T-006完成。inspect可返回当前语义摘要，不执行动作。

## 感知与预算

遍历主文档和open Shadow DOM，不进入iframe/closed Shadow DOM。输出角色、关联label/aria名称、文本、可用/可编辑/敏感标志和几何位置；观察不是完整浏览器无障碍树实现。跳过script/style/template、隐藏及视口外内容；可见iframe/canvas或不可读取的自定义控件标记unsupported_content。

默认最多扫描10,000个节点、输出200个元素、8,000字符文本；完整观察仍受24,000字符及65,536 UTF-8字节上限。超限裁剪文本和尾部元素，明确truncationReasons，不把未返回元素注册为当前观察可用目标。扫描达到上限时，无法穷尽敏感字段，保守抑制文本、元素名称和标题等字符串内容，不能静默宣称完整观察。

## 脱敏

password、one-time-code、以及name/id/autocomplete/aria-label/placeholder/label中可识别的密码、验证码、token、API key、secret字段标为敏感。收集已识别字段值后再生成文本和名称；不输出任何表单value属性，并清洗敏感值在页面中的回显。输入/textarea子树不作为页面正文。URL删除用户凭据与fragment，敏感query参数替换；已识别敏感值出现在path/query时也替换。

这不是通用个人信息识别器，不承诺识别任意自由文本中的未知秘密。识别信息太多超出扫描/清洗容量时，抑制可泄露文本而非返回未清洗内容。

## Chrome桥接

固定main frame与loader标识；文档变化重新创建isolated world和注册表，旧Target拒绝。observe中途导航导致上下文丢失时返回STALE_TARGET，调用方重新观察，不重试任何动作。未授权origin在注入前及页面内部都拒绝。transport断连返回DISCONNECTED。暂停/恢复/跨frame路由仍由后续模块实现。

## 完成与证据

单元测试验证注册表过期/移除/替换/跨作用域、清洗器、预算和CDP桥接错误处理；正式tsc及WXT构建保持通过。真实Chrome验证fixture控件、Shadow DOM、重渲染、导航、敏感值回显、裁剪与30次性能采样。必须单独记录真实浏览器结果；环境阻塞时T-005保持未完成，不能用模拟DOM或transport测试代替实际观察验证。
