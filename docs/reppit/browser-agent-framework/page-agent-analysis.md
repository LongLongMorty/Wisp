# Page Agent 技术分析与 Wisp 对比

**日期**：2026-11-03  
**来源**：https://github.com/alibaba/page-agent (MIT License, v1.12.4)  
**核心代码**：`packages/page-controller/src/dom/`（已读取并验证）

---

## 一、核心技术发现

### 1.1 DOM Dehydration 算法（FlatDomTree）

**文件**：`packages/page-controller/src/dom/index.ts` + `dom_tree/index.js`（1745 行，移植自 browser-use）

**核心思路**：
1. **遍历整个 DOM 树**，构建扁平化的 `FlatDomTree`（用 `{ rootId, map: Record<nodeId, DomNode> }` 结构）
2. **只保留可交互元素** + **语义标签**（nav/menu/header/footer 等）
3. **给每个可交互元素分配递增的 highlightIndex**（[0], [1], [2]...）
4. **压缩为纯文本**：`flatTreeToString()` 生成类似 Markdown 的结构

**输出示例**：
```
[0]<a aria-label=page-agent.js 首页 />
[1]<div >P />
[2]<div >page-agent.js
UI Agent in your webpage />
[3]<a >文档 />
[4]<a aria-label=查看源码（在新窗口打开）>源码 />
UI Agent in your webpage
用户输入需求，AI 理解页面并自动操作。
[5]<a role=button>快速开始 />
[6]<a role=button>查看文档 />
无需后端
```

**特点**：
- 用缩进表示层级关系
- 可交互元素用 `[index]` 标记，新出现的元素用 `*[index]` 标记
- 普通文本直接列出（如果父节点可见且是 topElement）
- 属性去重（如果多个属性值相同且长度 > 5，只保留一个）
- 属性与文本重复时删除属性（如 `aria-label` 等于文本内容）
- 属性值最多 20 字符，超出截断为 `...`

---

### 1.2 可交互元素判定逻辑

**来源**：`dom_tree/index.js` 的 `isInteractiveElement()` 函数（约 700-950 行）

**注释中的核心观点**：
> lots of comments, and uncommented code - to show the logic of what we already tried  
> One of the things we tried at the beginning was also to use event listeners, and other fancy class, style stuff -> **what actually worked best was just combining most things with computed cursor style :)**

**判定逻辑（按优先级排序）**：

1. **黑名单/白名单优先**（如果配置了 `interactiveBlacklist/Whitelist`）
2. **Cursor 样式判断**（核心机制，效果最好）：
   - 如果 `cursor` 是交互型（`pointer`、`move`、`text`、`grab`、`copy`、`cell`、`resize`、`zoom-in/out` 等 30+ 种）→ **直接返回 true**
   - 如果 `cursor` 是非交互型（`not-allowed`、`no-drop`、`wait`、`progress`）→ **返回 false**

3. **标签白名单**：
   - `a`、`button`、`input`、`select`、`textarea`、`details`、`summary`、`label`、`option`、`optgroup`、`fieldset`、`legend`
   - 但需检查是否被 `disabled`、`readOnly`、`inert` 禁用

4. **Role 白名单**：
   - `button`、`menu`、`menubar`、`menuitem*`、`radio`、`checkbox`、`tab`、`switch`、`slider`、`spinbutton`、`combobox`、`searchbox`、`textbox`、`listbox`、`option`、`scrollbar`

5. **contenteditable**：
   - `contenteditable="true"` 或 `element.isContentEditable`

6. **类名启发式**：
   - `classList` 包含 `button`、`dropdown-toggle`
   - 或有 `data-toggle="dropdown"`、`aria-haspopup="true"` 等属性

7. **事件监听器检查**（降级方案）：
   - 尝试调用 `window.getEventListeners(element)`（Chrome DevTools 专有）
   - 或 `window.getEventListenersForNode(element)`
   - 或回退到检查 `onclick`、`onmousedown` 等属性

8. **滚动元素**：
   - `isScrollableElement(element)` 检查 `overflow`/`scrollHeight`/`scrollWidth`

**与 Wisp 的对比**：

| 维度 | Page Agent | Wisp (`document.mts:177`) |
|------|-----------|---------------------------|
| **主要机制** | `cursor` 样式 + 标签白名单 | `roles.has(role(el))` + `tabIndex >= 0` + `cursor === 'pointer'` |
| **标签判定** | 30+ 种 cursor 样式枚举 | 固定 13 个 role（`button/link/textbox/checkbox` 等） |
| **事件监听** | 尝试但不依赖（注释说效果不好） | 不检查事件监听器 |
| **contenteditable** | 支持 | 支持（`role()` 返回 `textbox`） |
| **滚动元素** | 作为可交互元素 | 不作为可交互元素 |
| **禁用状态** | 检查 `disabled`/`readOnly`/`inert` | 检查 `:disabled`/`aria-disabled`/`inert` |

**关键差异**：
- Page Agent 更激进（cursor 样式覆盖面广，包含滚动元素）
- Wisp 更保守（固定 role 集合，不依赖 cursor 启发式）

---

### 1.3 文本收集策略

**函数**：`getAllTextTillNextClickableElement(node, maxDepth = -1)`

**逻辑**：
- 从当前节点开始，递归收集所有子节点的文本
- **遇到下一个可交互元素立即停止**（`if (currentNode !== node && currentNode.highlightIndex !== undefined) return`）
- 最多递归 `maxDepth` 层（默认 -1 无限制）

**用途**：
- 避免将嵌套可交互元素的文本重复输出
- 例如 `<button><span>点击</span>这里</button>`，只输出 "点击这里"

**与 Wisp 的对比**：
- **Wisp** (`document.mts:204-236`)：`bodyText()` 遍历所有文本节点，排除 `input/textarea/sensitive` 元素内的文本，**但不排除已在 `rawName()` 中收集的文本**
- **潜在问题**：Wisp 的 `bodyText()` 可能与 `ElementSummary.name` 重复（如按钮文本既在 `name` 又在 `text`）

---

### 1.4 新元素检测

**机制**：`newElementsCache = new WeakMap<HTMLElement, string>()`

**逻辑**：
1. 首次观察到某元素时，记录 `currentUrl`
2. 下次观察时，如果 `WeakMap` 中没有记录，标记为 `isNew = true`
3. 输出时用 `*[index]` 代替 `[index]` 表示新元素

**用途**：
- 提示模型关注新出现的元素（如加载更多后的列表项）

**与 Wisp 的对比**：
- **Wisp**：引用有 `observationId` 作用域，过期后必须重新观察，没有跨观察的"新元素"概念
- **设计差异**：Wisp 更严格（引用作用域隔离），Page Agent 更连续（跨观察缓存）

---

### 1.5 属性过滤与去重

**默认保留属性**（`flatTreeToString()` 中的 `DEFAULT_INCLUDE_ATTRIBUTES`）：
```js
'title', 'type', 'checked', 'name', 'role', 'value', 'placeholder',
'data-date-format', 'alt', 'aria-label', 'aria-expanded', 'data-state',
'aria-checked', 'id', 'for', 'target', 'aria-haspopup', 'aria-controls',
'aria-owns', 'contenteditable'
```

**去重规则**：
1. 多个属性值相同（长度 > 5）→ 只保留一个
2. `role` 等于 `tagName` → 删除 `role`
3. `aria-label`/`placeholder`/`title` 等于文本内容 → 删除该属性

**文本长度限制**：
- 属性值最多 20 字符，超出截断为 `...`

**与 Wisp 的对比**：
- **Wisp** (`document.mts:184-203`)：`ElementSummary` **不包含 HTML 属性**，只有语义化字段（`ref/tag/role/name/enabled/editable/sensitive/bounds/value/options`）
- **关键差异**：Wisp 输出的是结构化 JSON，Page Agent 输出的是带属性的纯文本

---

## 二、错误更正说明

**已修正的错误**（原版本 `bf95d9b` 已推送，现本地更正）：

1. **"Wisp 依赖无障碍树（AOM）"错误**
   - **实际**：Wisp 的 `interactive()` 函数（`document.mts:177`）使用 `roles.has(role(el))` 判定，其中 `role()` 函数根据标签名和属性映射返回语义角色
   - **不是** `computedRole`/`computedName` 等 AOM API

2. **"属性去重逻辑可借鉴"错误**
   - **实际**：Wisp 的 `ElementSummary` 根本不包含 HTML 属性字段，只有 `ref/tag/role/name/enabled/editable/sensitive/bounds/value/options`
   - **结论**：属性去重逻辑**不适用**于 Wisp

3. **示例代码有 bug**
   - **错误代码**：`if (result.role === result.tagName) delete result.role`
   - **问题**：`tagName` 不是 `ElementSummary` 的属性字段（实际是 `tag`）

4. **可交互判定列表不准确**
   - **错误**：原文列举了"标签名、角色、属性、事件监听器、cursor: pointer"
   - **实际**：Page Agent 的注释明确说 **cursor 样式效果最好**，事件监听器只是降级方案

5. **收益数字无依据**
   - **错误**：原文声称"减少 5-10%""10-20%""15-30%"
   - **实际**：这些数字是编造的，没有任何测量

6. **日期错误**
   - **错误**：三份文档日期都写成 `2024-11-03`
   - **实际**：今天是 `2026-11-03`

---

## 三、与 Wisp 的详细对比（已验证）

| 维度 | Page Agent | Wisp v0.1 | 差异 |
|------|-----------|-----------|------|
| **运行位置** | 页面内（`<script>` 嵌入） | 浏览器扩展（Chrome MV3） | 形态完全不同 |
| **DOM 访问** | 直接访问活页面 DOM | isolated world + CDP | Wisp 更安全 |
| **观察方式** | DOM 树遍历 + FlatDomTree 文本化 | 遍历 + `visible()` 过滤 + JSON 结构化 | Page Agent 更省 token，Wisp 更精确 |
| **可交互判定** | cursor 样式优先 + 30+ 种标签/角色 + 事件监听器 | 固定 13 个 role + `tabIndex >= 0` + `cursor === 'pointer'` | Page Agent 更激进，Wisp 更保守 |
| **执行方式** | 直接 DOM 操作（`element.click()`） | CDP 驱动（`Input.dispatchMouseEvent/KeyEvent`） | Wisp 更可靠（T-001 已验证） |
| **输出格式** | 纯文本（Markdown 风格，带属性） | JSON（`Observation` 结构，无属性） | Page Agent 省 token，Wisp 可解析 |
| **引用绑定** | `highlightIndex` + `WeakMap` 跨观察缓存 | `documentId/frameId/observationId/ref` 严格作用域 | Wisp 更安全 |
| **文本收集** | 遇下一个可交互元素停止 | 遍历所有文本节点，排除 input/textarea/sensitive | Page Agent 避免重复，Wisp 可能重复 |
| **Viewport** | 可配置 `-1`/`0`/正值（全页面/仅视口/扩展） | 固定观察视口内可见元素 | Page Agent 更灵活 |
| **Scroll 信息** | 详细（`pixels_above/below`、`pages_above/below`） | 简单（`scrollX/scrollY`、`width/height`） | Page Agent 更详细 |
| **模型接入** | 页面内调用（密钥在页面 JS 环境） | 扩展会话存储密钥，页面无权访问 | Wisp 更安全（NFR-003） |

---

## 四、Wisp 可以借鉴的部分（已重新评估）

### ✅ 有价值且可实施

#### 1. 文本收集策略优化（中优先级）

**问题**：Wisp 的 `bodyText()` 可能与 `ElementSummary.name` 重复

**验证**：
- `rawName(el)` (`document.mts:178-182`) 对按钮/链接使用 `el.textContent`
- `bodyText(nodes, limit)` (`document.mts:204-236`) 遍历所有文本节点，**不排除已在可交互元素中的文本**

**Page Agent 的做法**：
- `getAllTextTillNextClickableElement()` 遇下一个可交互元素立即停止

**建议**：
- 在 `bodyText()` 中，跳过 `interactive(el)` 为 true 的元素的文本节点
- 预期收益：减少 10-20% 观察文本冗余（**未测量，需验证**）
- 风险：中（可能影响模型理解，需回归测试）

---

#### 2. Scroll 信息增强（低优先级）

**问题**：Wisp 只提供 `viewport: {scrollX, scrollY, width, height}`，模型难以判断是否需要滚动

**Page Agent 的做法**：
```js
{
  pixels_above: scroll_y,
  pixels_below: page_height - (viewport_height + scroll_y),
  pages_above: scroll_y / viewport_height,
  pages_below: pixels_below / viewport_height,
  current_page_position: scroll_y / (page_height - viewport_height)
}
```

**建议**：
- 在 `Observation.viewport` 中添加 `scrollable: { hasMore: boolean, direction: 'up' | 'down' | 'both' }`
- 或添加 `pages_above/below` 字段
- 预期收益：改进模型滚动决策（**未测量**）
- 风险：低（只增加字段，不影响现有逻辑）

---

#### 3. 可交互判定增强（低优先级，需谨慎）

**问题**：Wisp 的固定 13 个 role 可能遗漏自定义组件

**Page Agent 的做法**：
- 检查 30+ 种 `cursor` 样式（`pointer/move/grab/resize/zoom-in` 等）

**建议**：
- 在 `interactive()` 中，补充检查 `cursor` 样式（当前只检查 `cursor === 'pointer'`）
- 风险：中（可能引入误判，如装饰性 hover 效果）

---

### ❌ 不适用或不建议

#### 1. 属性去重逻辑

**原因**：Wisp 的 `ElementSummary` 不包含 HTML 属性，只有语义化字段
**结论**：**完全不适用**

---

#### 2. 纯文本输出格式

**原因**：Wisp 的结构化 JSON 是核心优势，模型可以精确引用 `ref`
**结论**：**不采纳**

---

#### 3. WeakMap 引用缓存

**原因**：与 Wisp 的 `observationId` 作用域隔离冲突
**结论**：**不采纳**（Wisp 的设计更符合严格引用原则）

---

#### 4. DOM 事件合成

**原因**：Wisp 的 T-001 探针已验证 CDP 路径更可靠
**结论**：**不采纳**

---

## 五、具体行动计划（已调整）

### 阶段 1：文本收集优化（T-018 后，1 天）

**目标**：避免 `bodyText()` 与 `ElementSummary.name` 重复

1. **修改 `packages/browser-chrome/src/document.mts:204-236`**：
   ```ts
   function bodyText(nodes: Node[], limit: number) {
       if (suppressed) return '';
       let text = '';
       for (const node of nodes) {
           if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
           const parent = node.parentElement;
           if (!parent || !visible(parent)) continue;
           
           // 新增：跳过可交互元素内的文本（已在 rawName 中收集）
           let excluded = false;
           for (let el: Element | null = parent; el; el = composedParent(el)) {
               if (interactive(el)) {  // 新增检查
                   excluded = true;
                   break;
               }
               if (['input', 'textarea'].includes(el.localName) || sensitive(el)) {
                   excluded = true;
                   break;
               }
           }
           if (excluded) continue;
           
           // ... 其余逻辑不变
       }
       return text;
   }
   ```

2. **验证**：
   - `npm run observer:smoke` — 确保观察器通过
   - 对比优化前后的 `Observation.text` 大小
   - 回归测试：`npm test`

---

### 阶段 2：Scroll 信息增强（v0.2，0.5 天）

1. **修改 `packages/protocol/src/observation.mts:35-41`**：
   ```ts
   viewport: {
       width: number;
       height: number;
       dpr: number;
       scrollX: number;
       scrollY: number;
       scrollable?: {  // 新增可选字段
           hasMore: boolean;
           direction: 'up' | 'down' | 'both' | 'none';
       };
   };
   ```

2. **修改 `packages/browser-chrome/src/document.mts:278`**：
   - 在 `capture()` 中计算 `scrollHeight/scrollWidth` 与视口的关系
   - 填充 `viewport.scrollable` 字段

3. **验证**：同阶段 1

---

### 阶段 3：可交互判定增强（v0.3+，需更多真实站点验证）

**触发条件**：T-018 发现大量自定义组件未被识别

1. **修改 `packages/browser-chrome/src/document.mts:177`**：
   ```ts
   function interactive(el: Element) {
       if (roles.has(role(el)) || (el as HTMLElement).tabIndex >= 0) return true;
       
       const cursor = style(el).cursor;
       // 扩展 cursor 检查（参考 Page Agent 的 interactiveCursors）
       const interactiveCursors = new Set(['pointer', 'move', 'grab', 'grabbing', 'cell', 'copy', 'zoom-in', 'zoom-out']);
       if (interactiveCursors.has(cursor)) return true;
       
       return false;
   }
   ```

2. **验证**：需要在多个真实站点验证，避免误判

---

## 六、总结

### ✅ Page Agent 的价值

1. **文本收集策略**：避免重复（可借鉴）
2. **Scroll 信息**：改进模型决策（可借鉴）
3. **Cursor 样式判定**：覆盖面广（需谨慎借鉴）

### ❌ 不适合 Wisp 的部分

1. **属性去重**：Wisp 无属性字段，完全不适用
2. **DOM 事件合成**：Wisp 的 CDP 路径更可靠
3. **WeakMap 缓存**：与 Wisp 的作用域隔离冲突
4. **纯文本输出**：Wisp 的结构化 JSON 更精确

### 🎯 行动优先级

1. **T-018 后立即做**：文本收集优化（1 天，需测量实际收益）
2. **v0.2 考虑**：Scroll 信息增强（0.5 天）
3. **v0.3+ 考虑**：可交互判定增强（需更多站点验证）

---

**重要声明**：本文档所有"预期收益"均未经测量，需在 T-018 真实场景中验证。
