import type { Observation, ElementSummary, Target, TruncationReason } from '@wisp/protocol';
import type { createReferenceRegistry } from './references.mts';
import type { createSanitizer, Sanitizer } from './sanitize.mts';
export type ObservationOptions = {
    maxElements?: number;
    maxTextChars?: number;
    maxChars?: number;
    maxBytes?: number;
    maxNodes?: number;
};
export type ObserverContext = {
    documentId: string;
    frameId: string;
    allowedOrigins: readonly string[];
};
export type DocumentObserver = {
    observe(options?: ObservationOptions): Observation;
    snapshot(): Observation;
    resolve(target: Target): Element;
    inspect(target: Target): ElementSummary;
    dispose(): void;
};
export function createDocumentObserver(doc: Document, context: ObserverContext, createRegistry: typeof createReferenceRegistry, makeSanitizer: typeof createSanitizer): DocumentObserver {
    function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
    const win = doc.defaultView;
    if (!win)
        fail('DISCONNECTED');
    const registry = createRegistry<Element>({ documentId: context.documentId, frameId: context.frameId });
    const observers = new Map<Node, MutationObserver>();
    let disposed = false, styles = new Map<Element, CSSStyleDeclaration>(), sanitizer: Sanitizer = makeSanitizer([]), suppressed = false, reasons = new Set<TruncationReason>();
    const skip = new Set(['script', 'style', 'template', 'noscript', 'svg']);
    const roles = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'switch', 'tab', 'menuitem', 'slider', 'spinbutton', 'treeitem', 'gridcell']);
    function active() {
        if (disposed)
            fail('DISCONNECTED');
        if (!context.allowedOrigins.includes(new URL(doc.URL).origin))
            fail('PERMISSION_DENIED');
    }
    function composedParent(el: Element): Element | null { return el.parentElement || (el.getRootNode() instanceof win!.ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null); }
    function within(root: Node, node: Element) {
        for (let current: Element | null = node; current; current = composedParent(current))
            if (root === current)
                return true;
        return false;
    }
    function mutations(records: MutationRecord[]) {
        if (disposed)
            return;
        const removed: Node[] = [];
        for (const record of records)
            for (const node of record.removedNodes) {
                if (removed.length >= 2048) {
                    registry.invalidate(() => true);
                    return;
                }
                removed.push(node);
            }
        if (removed.length)
            registry.invalidate(node => removed.some(root => within(root, node)));
    }
    function watch(root: Node) {
        if (observers.has(root))
            return;
        const observer = new win!.MutationObserver(mutations);
        observer.observe(root, { childList: true, subtree: true });
        observers.set(root, observer);
    }
    function drain() {
        for (const [root, observer] of observers) {
            mutations(observer.takeRecords());
            if (root !== doc && !root.isConnected) {
                observer.disconnect();
                observers.delete(root);
            }
        }
    }
    watch(doc);
    function style(el: Element) {
        let value = styles.get(el);
        if (!value) {
            value = win!.getComputedStyle(el);
            styles.set(el, value);
        }
        return value;
    }
    function visible(el: Element) {
        for (let node: Element | null = el; node; node = composedParent(node)) {
            const s = style(node);
            if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0')
                return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < win!.innerWidth && r.top < win!.innerHeight;
    }
    function labels(el: Element) { const field = el as HTMLInputElement; return field.labels ? [...field.labels].map(label => { const nodes: Node[] = [label]; let text = '', count = 0; while(nodes.length && count++ < 256 && text.length < 2048) { const n=nodes.pop()!; if(n.nodeType===3)text+=' '+(n.textContent||''); else if(n===label || !['input','textarea','select','button','option'].includes((n as Element).localName)) for(let i=n.childNodes.length-1;i>=0;i--)nodes.push(n.childNodes[i]!); } return text.trim(); }).join(' ') : ''; }
    function metadata(el: Element) { return ['type', 'name', 'id', 'autocomplete', 'aria-label', 'placeholder'].map(key => el.getAttribute(key) || '').join(' ') + ' ' + labels(el); }
    function sensitive(el: Element) { return el.getAttribute('type')?.toLowerCase() === 'password' || sanitizer.sensitive(metadata(el)); }
    function collect(maxNodes: number) {
        const result: Node[] = [], stack: Node[] = doc.body ? [doc.body] : [];
        let clipped = false;
        function push(nodes: NodeListOf<ChildNode>) {
            const count = Math.min(nodes.length, Math.max(0, maxNodes - result.length - stack.length));
            if (count < nodes.length)
                clipped = true;
            for (let i = count - 1; i >= 0; i--)
                stack.push(nodes[i]!);
        }
        while (stack.length && result.length < maxNodes) {
            const node = stack.pop()!;
            result.push(node);
            if (node.nodeType === 1) {
                const el = node as Element, tag = el.localName;
                if (skip.has(tag) || tag === 'iframe' || tag === 'canvas')
                    continue;
                if (el.shadowRoot) {
                    watch(el.shadowRoot);
                    push(el.shadowRoot.childNodes);
                }
            }
            push(node.childNodes);
        }
        return { nodes: result, incomplete: clipped || stack.length > 0 };
    }
    function prepare(maxNodes: number) {
        styles = new Map();
        sanitizer = makeSanitizer([]);
        const scan = collect(maxNodes), secrets: string[] = [];
        let length = 0;
        suppressed = scan.incomplete || scan.nodes.some(node => node.nodeType === 3 && (node.textContent?.length || 0) > 65536);
        for (const node of scan.nodes)
            if (node.nodeType === 1) {
                const el = node as Element;
                if (sensitive(el)) {
                    const field = el as HTMLInputElement;
                    const value = typeof field.value === 'string' ? field.value : el.hasAttribute('contenteditable') ? el.textContent || '' : '';
                    length += value.length;
                    if (length > 65536) {
                        suppressed = true;
                        break;
                    }
                    if (value)
                        secrets.push(value);
                }
            }
        sanitizer = makeSanitizer(secrets);
        if (suppressed)
            reasons.add('unsupported_content');
        return scan.nodes;
    }
    function role(el: Element) {
        const explicit = (el.getAttribute('role') || '').split(/\s+/)[0] || '';
        if (roles.has(explicit))
            return explicit;
        const tag = el.localName;
        if (tag === 'button' || tag === 'summary')
            return 'button';
        if (tag === 'a' && el.hasAttribute('href'))
            return 'link';
        if (tag === 'textarea')
            return 'textbox';
        if (tag === 'select')
            return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
        if (tag === 'input') {
            const type = (el as HTMLInputElement).type;
            if (['button', 'submit', 'reset', 'image'].includes(type))
                return 'button';
            if (['checkbox', 'radio'].includes(type))
                return type;
            if (type === 'range')
                return 'slider';
            if (type === 'number')
                return 'spinbutton';
            return type === 'search' ? 'searchbox' : 'textbox';
        }
        return (el as HTMLElement).isContentEditable ? 'textbox' : 'generic';
    }
    function interactive(el: Element) { return roles.has(role(el)) || (el as HTMLElement).tabIndex >= 0 || style(el).cursor === 'pointer'; }
    function rawName(el: Element) {
        const ids = (el.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
        const root = el.getRootNode() as Document | ShadowRoot;
        const referenced = ids.map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
        return referenced || el.getAttribute('aria-label') || labels(el) || (['input', 'textarea'].includes(el.localName) ? el.getAttribute('placeholder') || '' : el.textContent || '') || el.getAttribute('title') || '';
    }
    function summary(el: Element, ref: string): ElementSummary {
        const rect = el.getBoundingClientRect();
        const raw = suppressed ? '' : sanitizer.text(rawName(el)).replace(/\s+/g, ' ').trim();
        if (raw.length > 1024)
            reasons.add('text_limit');
        let enabled = !el.matches(':disabled');
        for (let parent: Element | null = el; parent; parent = composedParent(parent))
            if (parent.getAttribute('aria-disabled') === 'true' || parent.hasAttribute('inert'))
                enabled = false;
        const field = el as HTMLInputElement;
        const tag = el.localName.includes('-') ? 'custom' : el.localName;
        const result: ElementSummary = { ref, tag: tag.slice(0, 64), role: role(el), name: suppressed ? '' : sanitizer.text(raw, 1024), enabled, editable: ((tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'hidden', 'file', 'image', 'range', 'color'].includes(field.type)) || tag === 'textarea' || (el as HTMLElement).isContentEditable) && !field.readOnly, sensitive: sensitive(el), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        if(!suppressed && !result.sensitive && (tag==='textarea' || tag==='select' || tag==='input' && ['text','search','email','url','tel','number'].includes(field.type))) {
            const value=field.value; result.value=sanitizer.text(value.slice(0,65536),2048); result.valueTruncated=value.length>2048;
            if(tag==='select') { const select=el as HTMLSelectElement; result.options=[]; result.optionsTruncated=select.options.length>50;
                for(let i=0;i<Math.min(select.options.length,50);i++) { const o=select.options[i]!; if(o.value.length>256 || o.label.length>256){result.optionsTruncated=true;continue;} result.options.push({value:sanitizer.text(o.value,256),label:sanitizer.text(o.label,256),selected:o.selected,disabled:o.disabled || o.parentElement?.localName==='optgroup' && (o.parentElement as HTMLOptGroupElement).disabled}); }
            }
        }
        return result;
    }
    function bodyText(nodes: Node[], limit: number) {
        if (suppressed)
            return '';
        let text = '';
        for (const node of nodes) {
            if (node.nodeType !== 3 || !node.textContent?.trim())
                continue;
            const parent = node.parentElement;
            if (!parent || !visible(parent))
                continue;
            let excluded = false;
            for (let el: Element | null = parent; el; el = composedParent(el))
                if (['input', 'textarea'].includes(el.localName) || sensitive(el)) {
                    excluded = true;
                    break;
                }
            if (excluded)
                continue;
            const range = doc.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= win!.innerHeight || r.right <= 0 || r.left >= win!.innerWidth)
                continue;
            const part = sanitizer.text(node.textContent).replace(/\s+/g, ' ').trim();
            if (text.length + part.length + 1 > limit) {
                text = (text + ' ' + part).slice(0, limit);
                reasons.add('text_limit');
                break;
            }
            text += (text ? ' ' : '') + part;
        }
        return text;
    }
    function resolveTarget(target: Target) {
        active();
        drain();
        const el = registry.resolve(target);
        if (el.ownerDocument !== doc)
            fail('STALE_TARGET');
        return el;
    }
    function options(input: ObservationOptions) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
            fail('BUDGET_EXCEEDED');
        if (Object.keys(input).some(key => !['maxElements', 'maxTextChars', 'maxChars', 'maxBytes', 'maxNodes'].includes(key)))
            fail('BUDGET_EXCEEDED');
        const result = { maxElements: input.maxElements ?? 200, maxTextChars: input.maxTextChars ?? 8000, maxChars: input.maxChars ?? 24000, maxBytes: input.maxBytes ?? 65536, maxNodes: input.maxNodes ?? 10000 };
        for (const [key, min, max] of [['maxElements', 1, 200], ['maxTextChars', 0, 24000], ['maxChars', 1024, 24000], ['maxBytes', 1024, 65536], ['maxNodes', 1, 10000]] as const)
            if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max)
                fail('BUDGET_EXCEEDED');
        return result;
    }
    function capture(input: ObservationOptions = {}, retain = true): Observation {
        active();
        drain();
        registry.collect();
        reasons = new Set();
        const limits = options(input), nodes = prepare(limits.maxNodes), elements: ElementSummary[] = [];
        for (const node of nodes) {
            if (node.nodeType !== 1)
                continue;
            const el = node as Element;
            if (!visible(el))
                continue;
            if (el.localName === 'iframe' || el.localName === 'canvas' || (el.localName.includes('-') && !el.shadowRoot))
                reasons.add('unsupported_content');
            if (skip.has(el.localName) || !interactive(el))
                continue;
            if (elements.length >= limits.maxElements) {
                reasons.add('element_limit');
                continue;
            }
            elements.push(summary(el, registry.reference(el)));
        }
        const observation: Observation = { observationId: crypto.randomUUID(), documentId: context.documentId, frameId: context.frameId, url: suppressed ? new URL(doc.URL).origin + '/' : sanitizer.url(doc.URL), title: suppressed ? '' : sanitizer.text(doc.title, 2048), capturedAt: new Date().toISOString(), viewport: { width: Math.max(1, win!.innerWidth), height: Math.max(1, win!.innerHeight), dpr: win!.devicePixelRatio, scrollX: win!.scrollX, scrollY: win!.scrollY }, elements, text: bodyText(nodes, limits.maxTextChars), truncated: false, truncationReasons: [] };
        for (;;) {
            observation.truncationReasons = [...reasons];
            observation.truncated = reasons.size > 0;
            const json = JSON.stringify(observation);
            if (json.length <= limits.maxChars && new TextEncoder().encode(json).byteLength <= limits.maxBytes)
                break;
            reasons.add(json.length > limits.maxChars ? 'text_limit' : 'byte_limit');
            if (observation.text.length)
                observation.text = observation.text.slice(0, Math.max(0, observation.text.length - Math.max(1, Math.ceil(observation.text.length / 4))));
            else if (observation.elements.length)
                observation.elements.pop();
            else if (observation.title)
                observation.title = '';
            else if (observation.url !== new URL(doc.URL).origin + '/')
                observation.url = new URL(doc.URL).origin + '/';
            else
                fail('BUDGET_EXCEEDED');
        }
        if (retain)
            registry.publish(observation.observationId, observation.elements.map(el => el.ref));
        return observation;
    }
    return {
        observe: input => capture(input),
        snapshot: () => capture({}, false),
        resolve: resolveTarget,
        inspect(target) { const el = resolveTarget(target); reasons = new Set(); prepare(10000); return summary(el, target.ref); },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            for (const observer of observers.values())
                observer.disconnect();
            observers.clear();
            styles.clear();
            registry.dispose();
        },
    };
}
