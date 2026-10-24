import type { ActionRequest, PolicyContext, PolicyTarget } from '@wisp/protocol';
import type { Target, Condition, ConditionResult, Verification } from '@wisp/protocol';
import type { DocumentObserver } from './document.mts';
export type PreparedTarget = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type DocumentController = {
    context(request: ActionRequest): Promise<PolicyContext>;
    prepare(target: Target, kind: string, focused?: boolean, focus?: boolean): PreparedTarget;
    check(conditions: Condition[]): Verification;
    selectOption(target: Target, value: string): { dispatched: 'yes'|'no'|'unknown'; code?: string };
};
export function createDocumentController(doc: Document, observer: DocumentObserver): DocumentController {
    const win = doc.defaultView!;
    function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
    function parent(el: Element): Element | null { return el.parentElement || (el.getRootNode() instanceof win.ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null); }
    function contains(root: Element, node: Element | null) {
        for (let el = node; el; el = parent(el))
            if (el === root)
                return true;
        return false;
    }
    function focused() {
        let el = doc.activeElement;
        while (el?.shadowRoot?.activeElement)
            el = el.shadowRoot.activeElement;
        return el;
    }
    async function digest(value: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join(''); }
    return {
        selectOption(target, value) {
            let started=false;
            try {
            this.prepare(target,'selectOption');
            const el=observer.resolve(target) as HTMLSelectElement;
            if(el.localName!=='select' || el.multiple)fail('UNSUPPORTED_CAPABILITY');
            if(el.options.length>2000)fail('BUDGET_EXCEEDED');
            const matches=[...el.options].filter(o=>o.value===value);
            if(matches.length>1)fail('AMBIGUOUS_TARGET');
            if(matches.length!==1 || matches[0]!.disabled || matches[0]!.parentElement?.localName==='optgroup' && (matches[0]!.parentElement as HTMLOptGroupElement).disabled)fail('NOT_ACTIONABLE');
            started=true; Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype,'value')!.set!.call(el,value);
            el.dispatchEvent(new win.Event('input',{bubbles:true}));
            el.dispatchEvent(new win.Event('change',{bubbles:true}));
            observer.resolve(target);
            if(el.value!==value)fail('NOT_ACTIONABLE');
            return {dispatched:'yes'};
            } catch(error) { return {dispatched:started?'unknown':'no',code:error && typeof error==='object' && 'code' in error ? String(error.code):'DISCONNECTED'}; }
        },
        async context(request) {
            const snapshot = observer.snapshot(), action = request.action;
            let complete = !snapshot.truncated;
            const controls: unknown[] = [], nodes: Node[] = doc.body ? [doc.body] : [];
            let count = 0, chars = doc.URL.length;
            function attributes(el: Element) { const attrs: string[][] = []; if (el.attributes.length > 64)
                complete = false; for (let i = 0; i < Math.min(el.attributes.length, 64); i++) {
                const a = el.attributes[i]!;
                if (a.name === 'value')
                    continue;
                if (a.name.length > 64 || a.value.length > 2048) {
                    complete = false;
                    continue;
                }
                chars += a.name.length + a.value.length;
                if (chars > 65536) {
                    complete = false;
                    break;
                }
                attrs.push([a.name, a.value]);
            } return attrs.sort(); }
            const sensitive = (el: Element) => el.getAttribute('type')?.toLowerCase() === 'password' || /password|passwd|secret|token|authorization|api[ _-]?key|one-time-code|(?:^|[^a-z])otp(?:[^a-z]|$)|密码|口令|验证码|密钥|令牌/i.test(['name', 'id', 'autocomplete', 'aria-label', 'placeholder'].map(k => el.getAttribute(k) || '').join(' ') + ' ' + ((el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!].map(l => l.textContent || '').join(' ') : ''));
            let hasSensitive = false;
            while (nodes.length && count < 10000) {
                const node = nodes.pop()!;
                count++;
                if (node.nodeType === 1) {
                    const el = node as Element;
                    if (['script', 'style', 'template', 'noscript', 'svg', 'iframe'].includes(el.localName))
                        continue;
                    if (['input', 'textarea', 'select'].includes(el.localName) || el.hasAttribute('contenteditable')) {
                        const field = el as HTMLInputElement;
                        const privateField = sensitive(el);
                        hasSensitive ||= privateField;
                        const value = privateField ? '[SENSITIVE]' : typeof field.value === 'string' ? field.value : el.textContent || '';
                        chars += value.length;
                        if (chars > 65536 || (field.name || '').length > 2048 || el.id.length > 2048) {
                            complete = false;
                            break;
                        }
                        const meta = { tag: el.localName, type: field.type || '', name: field.name || '', id: el.id, value, checked: !!field.checked, disabled: !!field.disabled };
                        chars += JSON.stringify(meta).length;
                        if (chars > 65536) {
                            complete = false;
                            break;
                        }
                        controls.push(meta);
                    }
                    if (el.shadowRoot) {
                        const children = el.shadowRoot.childNodes;
                        for (let i = children.length - 1; i >= 0; i--) {
                            if (nodes.length + count >= 10000) {
                                complete = false;
                                break;
                            }
                            nodes.push(children[i]!);
                        }
                    }
                }
                for (let i = node.childNodes.length - 1; i >= 0; i--) {
                    if (nodes.length + count >= 10000) {
                        complete = false;
                        break;
                    }
                    nodes.push(node.childNodes[i]!);
                }
            }
            if (nodes.length || chars > 65536)
                complete = false;
            const documentDigest = await digest({ url: doc.URL.length <= 65536 ? doc.URL : "[URL_TOO_LONG]", controls });
            const result: PolicyContext = { origin: new URL(doc.URL).origin, url: snapshot.url, documentId: snapshot.documentId, frameId: snapshot.frameId, documentDigest, complete };
            if ('target' in action) {
                const el = observer.resolve(action.target), summary = observer.inspect(action.target);
                let link: HTMLAnchorElement | undefined;
                for (let current: Element | null = el; current; current = parent(current))
                    if (current.localName === 'a' && current.hasAttribute('href')) {
                        link = current as HTMLAnchorElement;
                        break;
                    }
                const field = el as HTMLInputElement, form = field.form;
                const destinationOrigins: string[] = [];
                let newWindow = false;
                let destination = '';
                if (link) {
                    destination = link.href;
                    newWindow = !!link.target && link.target !== '_self';
                }
                const isSubmit = !!form && (['submit', 'image'].includes(field.type) || action.kind === 'pressKey' && action.key === 'Enter');
                if (isSubmit) {
                    destination = field.hasAttribute('formaction') ? (field as HTMLButtonElement).formAction : form!.action || doc.URL;
                    const windowTarget = field.hasAttribute('formtarget') ? (field as HTMLButtonElement).formTarget : form!.target;
                    newWindow ||= !!windowTarget && windowTarget !== '_self';
                    if (action.kind === 'pressKey')
                        for (let index = 0; index < Math.min(form!.elements.length, 2000); index++) {
                            const submitter = form!.elements[index]!;
                            if (form!.elements.length > 2000)
                                complete = false;
                            const input = submitter as HTMLInputElement;
                            if (!['submit', 'image'].includes(input.type) || input.disabled)
                                continue;
                            const to = input.hasAttribute('formaction') ? input.formAction : form!.action || doc.URL;
                            try {
                                if (to.length > 4096) {
                                    complete = false;
                                    continue;
                                }
                                const u = new URL(to, doc.URL);
                                if (!['http:', 'https:'].includes(u.protocol))
                                    complete = false;
                                else
                                    destinationOrigins.push(u.origin);
                            }
                            catch {
                                complete = false;
                            }
                            const w = input.hasAttribute('formtarget') ? input.formTarget : form!.target;
                            if (w && w !== '_self')
                                newWindow = true;
                        }
                }
                if (destination.length > 4096) {
                    complete = false;
                    destination = "";
                }
                if (destination) {
                    try {
                        const u = new URL(destination, doc.URL);
                        if (!['http:', 'https:'].includes(u.protocol))
                            complete = false;
                        else
                            destinationOrigins.push(u.origin);
                    }
                    catch {
                        complete = false;
                    }
                }
                const formHint = (form?.getAttribute('aria-label') || '').slice(0, 2048) + ' ' + (form?.getAttribute('name') || '').slice(0, 2048) + ' ' + (form?.action || '').slice(0, 4096);
                const hint = [field.type || '', isSubmit ? 'submit' : '', link ? 'link' : '', /pay|checkout|purchase|支付|付款/i.test(formHint) ? 'payment' : '', /login|sign.in|oauth|authoriz|密码|验证码|登录/i.test(formHint) ? 'authentication' : ''].join(' ');
                const target: PolicyTarget = { ref: summary.ref, tag: summary.tag, role: summary.role, name: summary.name, hint, enabled: summary.enabled, editable: summary.editable, sensitive: summary.sensitive, formSensitive: hasSensitive && !!form, inputType: field.type || '', destinationOrigins: [...new Set(destinationOrigins)].slice(0, 4), newWindow, fingerprint: await digest({ attributes: attributes(el), formAttributes: form ? attributes(form) : [], summary, type: field.type || '', hint, destination, formAction: form?.action || '', formMethod: form?.method || '', newWindow }) };
                result.target = target;
                result.complete = complete && new Set(destinationOrigins).size <= 4;
            }
            if (new URL(doc.URL).origin !== result.origin)
                throw Object.assign(new Error('STALE_TARGET'), { code: 'STALE_TARGET' });
            return result;
        },
        prepare(target, kind, needFocus = false, focus = false) {
            const el = observer.resolve(target), summary = observer.inspect(target);
            if (summary.sensitive)
                fail('POLICY_DENIED');
            if (!summary.enabled)
                fail('NOT_ACTIONABLE');
            for (let current: Element | null = el; current; current = parent(current)) {
                const style = win.getComputedStyle(current);
                if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.pointerEvents === 'none')
                    fail('NOT_ACTIONABLE');
            }
            const r = el.getBoundingClientRect(), left = Math.max(0, r.left), right = Math.min(win.innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(win.innerHeight, r.bottom);
            if (right <= left || bottom <= top || r.width <= 0 || r.height <= 0)
                fail('NOT_ACTIONABLE');
            const x = (left + right) / 2, y = (top + bottom) / 2;
            let hit = doc.elementFromPoint(x, y);
            while (hit?.shadowRoot) {
                const next = hit.shadowRoot.elementFromPoint(x, y);
                if (!next || next === hit)
                    break;
                hit = next;
            }
            if (!contains(el, hit))
                fail('NOT_ACTIONABLE');
            const field = el as HTMLInputElement;
            if (kind === 'fill' && (!summary.editable || !['input', 'textarea'].includes(el.localName) || el.localName === 'input' && !['text', 'search', 'email', 'url', 'tel', 'password'].includes(field.type)))
                fail('UNSUPPORTED_CAPABILITY');
            if (focus)
                (el as HTMLElement).focus({ preventScroll: true });
            if ((needFocus || focus) && focused() !== el)
                fail('NOT_ACTIONABLE');
            return { x, y, width: r.width, height: r.height };
        },
        check(conditions) {
            const snapshot = observer.snapshot();
            const results: ConditionResult[] = conditions.map(condition => {
                let status: ConditionResult['status'] = 'unknown';
                if (condition.kind === 'url')
                    status = ('equals' in condition ? snapshot.url===condition.equals : snapshot.url.startsWith(condition.startsWith)) ? 'passed' : 'failed';
                else if (condition.kind === 'text')
                    status = snapshot.text.includes(condition.includes) ? 'passed' : snapshot.truncated ? 'unknown' : 'failed';
                else if (condition.kind === 'element') {
                    const matches = snapshot.elements.filter(el => el.role === condition.role && el.name === condition.name);
                    if (matches.length > 1)
                        fail('AMBIGUOUS_TARGET');
                    if (!snapshot.truncated)
                        status = (condition.state === 'visible' ? matches.length === 1 : matches.length === 0) ? 'passed' : 'failed';
                    else if (condition.state === 'absent' && matches.length)
                        status = 'failed';
                }
                else {
                    const el = observer.resolve(condition.target), summary = observer.inspect(condition.target);
                    if (summary.sensitive)
                        fail('POLICY_DENIED');
                    if (!['input', 'textarea', 'select'].includes(el.localName))
                        fail('UNSUPPORTED_CAPABILITY');
                    status = (el as HTMLInputElement).value === condition.equals ? 'passed' : 'failed';
                }
                return { condition, status, evidence: [{ kind: condition.kind, url: snapshot.url, documentId: snapshot.documentId, observationId: snapshot.observationId, capturedAt: snapshot.capturedAt, actual: status === 'passed' ? 'matched' : status === 'failed' ? 'not_matched' : 'incomplete' }] };
            });
            return { status: results.some(r => r.status === 'failed') ? 'failed' : results.some(r => r.status === 'unknown') ? 'unknown' : 'passed', conditions: results };
        }
    };
}
