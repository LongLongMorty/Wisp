import { object, text, integer, numeric, boolean, choice, httpUrl, utc, list, unique, sized, fail, decode } from './validation.mts';
import { ERROR_CODES, PROTOCOL_VERSION } from './validation.mts';
import type { ErrorCode } from './validation.mts';
import { parseCondition } from './actions.mts';
import type { Condition } from './actions.mts';
export const ACTION_KINDS = ['click', 'fill', 'pressKey', 'scroll', 'navigate', 'selectOption'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type Bounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type ElementSummary = {
    ref: string;
    tag: string;
    role: string;
    name: string;
    enabled: boolean;
    editable: boolean;
    sensitive: boolean;
    bounds: Bounds;
    value?: string;
    valueTruncated?: boolean;
    options?: { value: string; label: string; selected: boolean; disabled: boolean }[];
    optionsTruncated?: boolean;
};
export type Observation = {
    observationId: string;
    documentId: string;
    frameId: string;
    url: string;
    title: string;
    capturedAt: string;
    viewport: {
        width: number;
        height: number;
        dpr: number;
        scrollX: number;
        scrollY: number;
    };
    elements: ElementSummary[];
    text: string;
    truncated: boolean;
    truncationReasons: TruncationReason[];
};
const REASONS = ['element_limit', 'text_limit', 'byte_limit', 'unsupported_content'] as const;
export type TruncationReason = (typeof REASONS)[number];
export type Evidence = {
    kind: Condition['kind'];
    url: string;
    documentId: string;
    observationId: string;
    capturedAt: string;
    actual: string;
};
export type ErrorInfo = {
    code: ErrorCode;
    message: string;
    retryable: boolean;
};
export type ActionResult = {
    actionId: string;
    dispatched: 'yes' | 'no' | 'unknown';
    responded: 'yes' | 'no' | 'unknown';
    verified: 'passed' | 'failed' | 'not_checked' | 'unknown';
    evidence: Evidence[];
    error?: ErrorInfo;
};
export type ConditionResult = {
    condition: Condition;
    status: 'passed' | 'failed' | 'unknown';
    evidence: Evidence[];
};
export type Verification = {
    status: ConditionResult['status'];
    conditions: ConditionResult[];
};
export type Capabilities = {
    version: typeof PROTOCOL_VERSION;
    actions: ActionKind[];
    frames: 'main';
    shadowDOM: 'open';
};
export function parseBounds(v: unknown): Bounds {
    object(v, ['x', 'y', 'width', 'height'], [], 'bounds');
    return { x: numeric(v.x, 'bounds.x'), y: numeric(v.y, 'bounds.y'), width: numeric(v.width, 'bounds.width', 0), height: numeric(v.height, 'bounds.height', 0) };
}
export function parseElement(v: unknown): ElementSummary {
    object(v, ['ref', 'tag', 'role', 'name', 'enabled', 'editable', 'sensitive', 'bounds'], ['value','valueTruncated','options','optionsTruncated'], 'element');
    const result: ElementSummary = { ref: text(v.ref, 'element.ref'), tag: text(v.tag, 'element.tag', 64), role: text(v.role, 'element.role', 128), name: text(v.name, 'element.name', 1024, true), enabled: boolean(v.enabled, 'element.enabled'), editable: boolean(v.editable, 'element.editable'), sensitive: boolean(v.sensitive, 'element.sensitive'), bounds: parseBounds(v.bounds) };
    if (result.sensitive && ['value','valueTruncated','options','optionsTruncated'].some(k=>Object.hasOwn(v,k))) fail('element.sensitive');
    if (Object.hasOwn(v,'value')) { result.value=text(v.value,'element.value',2048,true); result.valueTruncated=boolean(v.valueTruncated,'element.valueTruncated'); }
    else if (Object.hasOwn(v,'valueTruncated')) fail('element.value');
    if (Object.hasOwn(v,'options')) { if(result.tag!=='select')fail('element.options'); result.options=list(v.options,o=>{object(o,['value','label','selected','disabled'],[],'option');return {value:text(o.value,'option.value',256,true),label:text(o.label,'option.label',256,true),selected:boolean(o.selected,'option.selected'),disabled:boolean(o.disabled,'option.disabled')}},'element.options',50); result.optionsTruncated=boolean(v.optionsTruncated,'element.optionsTruncated'); }
    else if(Object.hasOwn(v,'optionsTruncated'))fail('element.options');
    return result;
}
export function parseObservation(v: unknown): Observation {
    object(v, ['observationId', 'documentId', 'frameId', 'url', 'title', 'capturedAt', 'viewport', 'elements', 'text', 'truncated', 'truncationReasons'], [], 'observation');
    object(v.viewport, ['width', 'height', 'dpr', 'scrollX', 'scrollY'], [], 'viewport');
    const p = v.viewport;
    const elements = list(v.elements, parseElement, 'observation.elements');
    unique(elements.map(e => e.ref), 'observation.refs');
    const reasons = unique(list(v.truncationReasons, item => choice(item, REASONS, 'truncation.reason'), 'truncation.reasons', 4), 'truncation.reasons');
    const truncated = boolean(v.truncated, 'observation.truncated');
    if (truncated !== (reasons.length > 0))
        fail('observation.truncation');
    return sized({ observationId: text(v.observationId, 'observation.id'), documentId: text(v.documentId, 'observation.documentId'), frameId: text(v.frameId, 'observation.frameId'), url: httpUrl(v.url, 'observation.url'), title: text(v.title, 'observation.title', 2048, true), capturedAt: utc(v.capturedAt, 'observation.capturedAt'), viewport: { width: numeric(p.width, 'viewport.width', 1, 100000), height: numeric(p.height, 'viewport.height', 1, 100000), dpr: numeric(p.dpr, 'viewport.dpr', 0.1, 16), scrollX: numeric(p.scrollX, 'viewport.scrollX'), scrollY: numeric(p.scrollY, 'viewport.scrollY') }, elements, text: text(v.text, 'observation.text', 24000, true), truncated, truncationReasons: reasons }, 'observation.size', 24000);
}
export function decodeObservation(json: unknown): Observation { return decode(json, parseObservation); }
export function parseEvidence(v: unknown): Evidence {
    object(v, ['kind', 'url', 'documentId', 'observationId', 'capturedAt', 'actual'], [], 'evidence');
    return { kind: choice(v.kind, ['url', 'element', 'text', 'value'], 'evidence.kind'), url: httpUrl(v.url, 'evidence.url'), documentId: text(v.documentId, 'evidence.documentId'), observationId: text(v.observationId, 'evidence.observationId'), capturedAt: utc(v.capturedAt, 'evidence.capturedAt'), actual: text(v.actual, 'evidence.actual', 4096, true) };
}
export function parseError(v: unknown): ErrorInfo {
    object(v, ['code', 'message', 'retryable'], [], 'error');
    return { code: choice(v.code, ERROR_CODES, 'error.code'), message: text(v.message, 'error.message', 2048), retryable: boolean(v.retryable, 'error.retryable') };
}
export function parseActionResult(v: unknown): ActionResult {
    object(v, ['actionId', 'dispatched', 'responded', 'verified', 'evidence'], ['error'], 'actionResult');
    const result: ActionResult = { actionId: text(v.actionId, 'result.actionId'), dispatched: choice(v.dispatched, ['yes', 'no', 'unknown'], 'result.dispatched'), responded: choice(v.responded, ['yes', 'no', 'unknown'], 'result.responded'), verified: choice(v.verified, ['passed', 'failed', 'not_checked', 'unknown'], 'result.verified'), evidence: list(v.evidence, parseEvidence, 'result.evidence', 32) };
    if (Object.hasOwn(v, 'error'))
        result.error = parseError(v.error);
    if (result.verified === 'passed' && !result.evidence.length)
        fail('result.evidence');
    if (result.dispatched === 'no' && (result.responded === 'yes' || result.verified === 'passed'))
        fail('result.inconsistent');
    return result;
}
export function parseVerification(v: unknown): Verification {
    object(v, ['status', 'conditions'], [], 'verification');
    const conditions = list(v.conditions, item => {
        object(item, ['condition', 'status', 'evidence'], [], 'conditionResult');
        const parsed: ConditionResult = { condition: parseCondition(item.condition), status: choice(item.status, ['passed', 'failed', 'unknown'], 'conditionResult.status'), evidence: list(item.evidence, parseEvidence, 'conditionResult.evidence', 32) };
        if (parsed.status === 'passed' && !parsed.evidence.length)
            fail('conditionResult.evidence');
        return parsed;
    }, 'verification.conditions', 16, 1);
    const status = choice(v.status, ['passed', 'failed', 'unknown'], 'verification.status');
    const derived = conditions.some(c => c.status === 'failed') ? 'failed' : conditions.some(c => c.status === 'unknown') ? 'unknown' : 'passed';
    if (status !== derived)
        fail('verification.status');
    return { status, conditions };
}
export function parseCapabilities(v: unknown): Capabilities {
    object(v, ['version', 'actions', 'frames', 'shadowDOM'], [], 'capabilities');
    return { version: choice(v.version, [PROTOCOL_VERSION], 'capabilities.version'), actions: unique(list(v.actions, item => choice(item, ACTION_KINDS, 'capability.action'), 'capabilities.actions', 6, 1), 'capabilities.actions'), frames: choice(v.frames, ['main'], 'capabilities.frames'), shadowDOM: choice(v.shadowDOM, ['open'], 'capabilities.shadowDOM') };
}
