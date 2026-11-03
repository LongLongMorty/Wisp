# Page Agent 技术分析与 Wisp 对比

**日期**：2024-11-03  
**来源**：https://github.com/alibaba/page-agent (MIT License, v1.12.4)  
**核心代码**：`packages/page-controller/src/dom/`

---

## 一、核心技术发现

### 1.1 DOM Dehydration 算法（FlatDomTree）

**文件**：`packages/page-controller/src/dom/index.ts` + `dom_tree/index.js`（约 1000+ 行）

**核心思路**：
1. **遍历整个 DOM 树**，构建扁平化的 `FlatDomTree`
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
- 可交互元素用 `[index]` 标记
- 普通文本直接列出（如果父节点可见且是 topElement）
- 属性去重（如果多个属性值相同且长度 > 5，只保留一个）
- 属性与文本重复时删除属性（如 `aria-label` 等于文本内容）

---

### 1.2 可交互元素判定逻辑

**来源**：`dom_tree/index.js`（browser-use 移植版本）

**判定条件**（满足任一即可）：
1. **标签名**：`a`、`button`、`input`、`textarea`、`select`、`details`、`label`
2. **角色**：`role="button|link|checkbox|menuitem|tab|search|textbox"`
3. **属性**：`contenteditable="true"`、`tabindex >= 0`
4. **事件监听器**：`onclick`、`onmousedown`、`onmouseup`、`onkeydown`、`onkeyup`、`onkeypress`
5. **ARIA 属性**：`aria-haspopup`、`aria-controls`、`aria-expanded`
6. **特殊情况**：
   - `cursor: pointer` + 非空文本
   - `<div>` 包含 click 事件监听器

**黑名单/白名单**：
- 支持自定义 `interactiveBlacklist`（强制排除）
- 支持自定义 `interactiveWhitelist`（强制包含）

**与 Wisp 对比**：
- Wisp 依赖**无障碍树**（`computedRole`、`computedName`）
- Page Agent 直接遍历 DOM + 启发式规则

---

### 1.3 文本收集策略

**函数**：`getAllTextTillNextClickableElement()`

**逻辑**：
- 从当前节点开始，递归收集所有子节点的文本
- **遇到下一个可交互元素立即停止**
- 最多递归 `maxDepth` 层（默认 -1 无限制）

**目的**：
- 避免将嵌套可交互元素的文本重复输出
- 例如 `<button><span>点击</span>这里</button>`，只输出 "点击这里"

---

### 1.4 新元素检测

**机制**：`newElementsCache = new WeakMap<HTMLElement, string>()`

**逻辑**：
1. 首次观察到某元素时，记录 `currentUrl`
2. 下次观察时，如果 `WeakMap` 中没有记录，标记为 `isNew = true`
3. 输出时用 `*[index]` 代替 `[index]` 表示新元素

**用途**：
- 提示模型关注新出现的元素（如加载更多后的列表项）

**与 Wisp 对比**：
- Wisp 的引用有 `observationId` 作用域，过期后必须重新观察
- Page Agent 的 `WeakMap` 跨观察持久化（但刷新页面丢失）

---

### 1.5 属性过滤与去重

**默认保留属性**：
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

---

### 1.6 Viewport 扩展

**配置**：`viewportExpansion`
- `-1`：全页面（无视口限制）
- `0`：仅视口内
- 正值：视口扩展 N 像素

**注释说明**：
> Since isTopElement depends on elementFromPoint, it returns null when out of viewport, this feature has no practical use, only differ between -1 and 0

**实际行为**：
- 只区分 `-1`（全页面）和 `0`（仅视口）
- 正值扩展暂无实际效果

---

### 1.7 页面信息获取

**函数**：`getPageInfo()`（`getPageInfo.ts`）

**返回字段**：
```js
{
  viewport_width, viewport_height,     // 视口尺寸
  page_width, page_height,            // 页面总尺寸
  scroll_x, scroll_y,                 // 当前滚动位置
  pixels_above, pixels_below,         // 上下方剩余像素
  pages_above, pages_below,           // 上下方剩余页数
  total_pages,                        // 总页数
  current_page_position,              // 当前滚动百分比（0-1）
  pixels_left, pixels_right           // 左右剩余像素
}
```

**用途**：
- 模型判断是否需要滚动
- 与 Wisp 的 `Observation.viewport` 类似，但更详细

---

## 二、与 Wisp 的详细对比

| 维度 | Page Agent | Wisp v0.1 | 优劣 |
|------|-----------|-----------|------|
| **DOM 遍历** | 直接遍历 DOM 树 | 无障碍树（AOM）优先 | Page Agent 更全面，Wisp 更精简 |
| **可交互判定** | 启发式规则（标签+角色+属性+事件） | `computedRole` + `computedName` | Page Agent 覆盖更广，Wisp 更标准 |
| **文本压缩** | 递归收集 + 遇可交互元素停止 | 有界文本（24,000 字符预算） | Page Agent 策略更智能 |
| **属性过滤** | 去重 + 文本匹配删除 | 脱敏（密码/验证码） | Page Agent 优化 token，Wisp 优化安全 |
| **引用绑定** | `highlightIndex` + `WeakMap` | `documentId/frameId/observationId/ref` | Wisp 更严格（作用域隔离） |
| **新元素检测** | `WeakMap` 跨观察缓存 | 每次观察分配新 `observationId` | Page Agent 更连续，Wisp 更安全 |
| **输出格式** | 纯文本（Markdown 风格） | JSON（`Observation` 结构） | Page Agent 更省 token，Wisp 更结构化 |
| **视口限制** | 可配置 `-1`/`0`/正值 | 固定观察视口内可见元素 | Page Agent 更灵活 |
| **Scroll 信息** | 详细（`pages_above/below`） | 简单（`viewport: {scroll: {x, y}}`） | Page Agent 更详细 |

---

## 三、Wisp 可以借鉴的部分

### ✅ 高优先级（T-018 后立即实施）

#### 1. 属性去重与文本匹配删除

**问题**：Wisp 的观察器可能输出冗余属性，浪费 token

**Page Agent 的做法**：
```js
// 1. 多个属性值相同（长度 > 5）→ 只保留一个
if (value.length > 5) {
  if (value in seenValues) {
    keysToRemove.add(key)
  } else {
    seenValues[value] = key
  }
}

// 2. role 等于 tagName → 删除 role
if (attributesToInclude.role === node.tagName) {
  delete attributesToInclude.role
}

// 3. aria-label/placeholder/title 等于文本内容 → 删除
const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title']
for (const attr of attrsToRemoveIfTextMatches) {
  if (attributesToInclude[attr]?.toLowerCase().trim() === text.toLowerCase().trim()) {
    delete attributesToInclude[attr]
  }
}
```

**建议**：
- 在 `packages/browser-chrome/src/document.mts:317` 的观察器中添加类似逻辑
- 优先级：**高**（直接减少 token 消耗，无副作用）

---

#### 2. 文本收集策略优化

**问题**：Wisp 的文本可能包含嵌套可交互元素的重复内容

**Page Agent 的做法**：
- `getAllTextTillNextClickableElement()` 递归收集，遇下一个可交互元素停止

**建议**：
- 在 `packages/browser-chrome/src/document.mts` 中参考这个策略
- 优先级：**中**（改进观察质量，但需要测试）

---

#### 3. Scroll 信息增强

**问题**：Wisp 只提供 `scroll: {x, y}`，模型难以判断是否需要滚动

**Page Agent 的做法**：
```js
{
  pixels_above, pixels_below,
  pages_above, pages_below,
  current_page_position  // 0-1
}
```

**建议**：
- 在 `packages/protocol/src/observation.mts` 的 `Viewport` 类型中添加这些字段
- 优先级：**中**（改进模型决策，但不影响现有功能）

---

### ⚠️ 中等优先级（v0.2 考虑）

#### 4. 可交互元素判定增强

**问题**：Wisp 的无障碍树可能遗漏某些可交互元素（如自定义组件）

**Page Agent 的做法**：
- 启发式规则（事件监听器、`cursor: pointer`、`contenteditable`）

**建议**：
- 在 `packages/browser-chrome/src/document.mts` 中添加补充规则
- 优先级：**中**（扩大支持范围，但可能引入误判）

---

#### 5. 黑名单/白名单机制

**问题**：某些站点有装饰性可交互元素（如广告、追踪器）

**Page Agent 的做法**：
```js
interactiveBlacklist: [element1, element2]
interactiveWhitelist: [element3]
```

**建议**：
- 在 `packages/browser-chrome/src/adapter.mts` 的 `observe()` 中添加配置项
- 优先级：**低**（站点特定优化，不通用）

---

### ❌ 不建议借鉴

#### 6. 新元素检测的 WeakMap 方案

**Page Agent 的做法**：
```js
newElementsCache = new WeakMap<HTMLElement, string>()
```

**问题**：
- 跨观察持久化，可能导致引用绑定混乱
- Wisp 的 `observationId` 作用域隔离更安全

**建议**：**不采纳**（Wisp 的设计更符合严格引用原则）

---

#### 7. 纯文本输出格式

**Page Agent 的做法**：
- `flatTreeToString()` 输出 Markdown 风格纯文本

**问题**：
- 丢失结构化信息，模型难以精确引用
- Wisp 的 JSON + 引用绑定更可靠

**建议**：**不采纳**（Wisp 的结构化输出是核心优势）

---

## 四、具体行动计划

### 阶段 1：快速验证（1 天）

**目标**：提取 Page Agent 的属性去重逻辑，集成到 Wisp 观察器

1. **读取 Wisp 观察器**：
   ```
   packages/browser-chrome/src/document.mts:317
   ```

2. **添加属性去重函数**：
   ```ts
   function deduplicateAttributes(
     attributes: Record<string, string>,
     textContent: string
   ): Record<string, string> {
     const result = { ...attributes }
     
     // 1. 多个属性值相同（长度 > 5）→ 只保留一个
     const seenValues = new Map<string, string>()
     const keysToRemove = new Set<string>()
     for (const [key, value] of Object.entries(result)) {
       if (value.length > 5) {
         if (seenValues.has(value)) {
           keysToRemove.add(key)
         } else {
           seenValues.set(value, key)
         }
       }
     }
     for (const key of keysToRemove) {
       delete result[key]
     }
     
     // 2. role 等于 tagName → 删除 role
     if (result.role && result.role === result.tagName) {
       delete result.role
     }
     
     // 3. aria-label/placeholder/title 等于文本内容 → 删除
     const attrsToCheck = ['aria-label', 'placeholder', 'title']
     for (const attr of attrsToCheck) {
       if (result[attr]?.toLowerCase().trim() === textContent.toLowerCase().trim()) {
         delete result[attr]
       }
     }
     
     return result
   }
   ```

3. **集成到观察循环**：
   - 在生成 `InteractiveElement` 时调用 `deduplicateAttributes()`

4. **验证**：
   - 运行 `npm run observer:smoke`
   - 对比优化前后的观察输出大小

---

### 阶段 2：增强 Scroll 信息（0.5 天）

1. **修改 `packages/protocol/src/observation.mts`**：
   ```ts
   export type Viewport = {
     width: number
     height: number
     scroll: {
       x: number
       y: number
       pixelsAbove: number      // 新增
       pixelsBelow: number      // 新增
       pagesAbove: number       // 新增
       pagesBelow: number       // 新增
       currentPosition: number  // 新增（0-1）
     }
   }
   ```

2. **修改 `packages/browser-chrome/src/document.mts`**：
   - 在 `observe()` 中调用类似 `getPageInfo()` 的逻辑

3. **验证**：
   - 运行 `npm run observer:smoke`
   - 检查新字段是否正确

---

### 阶段 3：文本收集优化（1 天）

1. **实现 `getAllTextTillNextInteractiveElement()`**
2. **在观察器中替换现有文本收集逻辑**
3. **回归测试**：
   - `npm run observer:smoke`
   - `npm run control:smoke`
   - `npm test`

---

## 五、预期收益

| 优化项 | 预期收益 | 风险 |
|--------|---------|------|
| 属性去重 | 减少 5-10% 观察 token | 低（纯过滤，无副作用） |
| Scroll 信息 | 改进模型滚动决策准确率 | 低（只增加字段） |
| 文本收集优化 | 减少 10-20% 观察 token | 中（可能影响模型理解） |
| 可交互判定增强 | 扩大 5-15% 控件覆盖 | 中（可能引入误判） |

**总收益**：
- **观察序列化大小减少 15-30%**
- **模型 token 消耗减少 10-20%**
- **控件支持范围扩大 5-15%**

---

## 六、总结

### ✅ Page Agent 的价值

1. **属性去重与优化**：直接适用，立即提升 Wisp 观察器效率
2. **Scroll 信息增强**：改进模型决策质量
3. **文本收集策略**：智能剪枝，减少冗余

### ❌ 不适合 Wisp 的部分

1. **DOM 事件合成**：Wisp 的 CDP 路径更可靠
2. **WeakMap 引用缓存**：与 Wisp 的作用域隔离冲突
3. **纯文本输出**：Wisp 的结构化 JSON 更精确

### 🎯 行动优先级

1. **立即做**（T-018 后）：属性去重（1 天，高收益低风险）
2. **短期做**（v0.2）：Scroll 信息增强 + 文本收集优化（1.5 天）
3. **中期考虑**（v0.3）：可交互判定增强 + 黑名单/白名单

---

**下一步**：完成 T-018 后，用 T-018 的实际场景验证这些优化的效果。
