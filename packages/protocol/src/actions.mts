export type Target = {
    documentId: string;
    frameId: string;
    observationId: string;
    ref: string;
};
export type Condition = {
    kind: 'url';
    equals: string;
} | {
    kind: 'url';
    startsWith: string;
} | {
    kind: 'element';
    role: string;
    name: string;
    state: 'visible' | 'absent';
} | {
    kind: 'text';
    includes: string;
} | {
    kind: 'value';
    target: Target;
    equals: string;
};
export type BrowserAction = {
    kind: 'click';
    target: Target;
} | {
    kind: 'fill';
    target: Target;
    value: string;
} | {
    kind: 'selectOption';
    target: Target;
    value: string;
} | {
    kind: 'pressKey';
    target: Target;
    key: string;
} | {
    kind: 'scroll';
    direction: 'up' | 'down';
    pixels: number;
} | {
    kind: 'navigate';
    url: string;
};
export type ActionRequest = {
    actionId: string;
    action: BrowserAction;
    expected?: Condition[];
    timeoutMs: number;
};
import { object, text, integer, choice, httpUrl, fail, decode } from './validation.mts';
export function parseTarget(value: unknown): Target {
    object(value, ['documentId', 'frameId', 'observationId', 'ref'], [], 'target');
    return { documentId: text(value.documentId, 'target.documentId'), frameId: text(value.frameId, 'target.frameId'), observationId: text(value.observationId, 'target.observationId'), ref: text(value.ref, 'target.ref') };
}
export function parseCondition(value: unknown): Condition {
    object(value, ['kind'], ['equals', 'startsWith', 'role', 'name', 'state', 'includes', 'target'], 'condition');
    switch (value.kind) {
        case 'url':
            object(value, ['kind'], ['equals','startsWith'], 'condition');
            if(Object.hasOwn(value,'equals')===Object.hasOwn(value,'startsWith'))fail('condition.url');
            return Object.hasOwn(value,'equals')?{ kind: 'url', equals: httpUrl(value.equals, 'condition.equals') }:{kind:'url',startsWith:httpUrl(value.startsWith,'condition.startsWith')};
        case 'element':
            object(value, ['kind', 'role', 'name', 'state'], [], 'condition');
            return { kind: 'element', role: text(value.role, 'condition.role', 128), name: text(value.name, 'condition.name', 1024), state: choice(value.state, ['visible', 'absent'], 'condition.state') };
        case 'text':
            object(value, ['kind', 'includes'], [], 'condition');
            return { kind: 'text', includes: text(value.includes, 'condition.includes', 4096) };
        case 'value':
            object(value, ['kind', 'target', 'equals'], [], 'condition');
            return { kind: 'value', target: parseTarget(value.target), equals: text(value.equals, 'condition.equals', 8000, true) };
        default: fail('condition.kind');
    }
}
export const KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Control+A', 'Meta+A'];
export function parseBrowserAction(value: unknown): BrowserAction {
    object(value, ['kind'], ['target', 'value', 'key', 'direction', 'pixels', 'url'], 'action');
    switch (value.kind) {
        case 'click':
            object(value, ['kind', 'target'], [], 'action');
            return { kind: 'click', target: parseTarget(value.target) };
        case 'fill':
            object(value, ['kind', 'target', 'value'], [], 'action');
            return { kind: 'fill', target: parseTarget(value.target), value: text(value.value, 'action.value', 8000, true) };
        case 'pressKey':
            object(value, ['kind', 'target', 'key'], [], 'action');
            return { kind: 'pressKey', target: parseTarget(value.target), key: choice(value.key, KEYS, 'action.key') };
        case 'selectOption':
            object(value, ['kind', 'target', 'value'], [], 'action');
            return { kind: 'selectOption', target: parseTarget(value.target), value: text(value.value, 'action.value', 256, true) };
        case 'scroll':
            object(value, ['kind', 'direction', 'pixels'], [], 'action');
            return { kind: 'scroll', direction: choice(value.direction, ['up', 'down'], 'action.direction'), pixels: integer(value.pixels, 'action.pixels', 1, 2000) };
        case 'navigate':
            object(value, ['kind', 'url'], [], 'action');
            return { kind: 'navigate', url: httpUrl(value.url, 'action.url') };
        default: fail('action.kind');
    }
}
export function parseActionRequest(value: unknown): ActionRequest {
    object(value, ['actionId', 'action', 'timeoutMs'], ['expected'], 'request');
    const parsed: ActionRequest = { actionId: text(value.actionId, 'request.actionId'), action: parseBrowserAction(value.action), timeoutMs: integer(value.timeoutMs, 'request.timeoutMs', 1, 30000) };
    if (Object.hasOwn(value, 'expected')) {
        if (!Array.isArray(value.expected) || value.expected.length > 16)
            fail('request.expected');
        parsed.expected = Array.from(value.expected, parseCondition);
    }
    return parsed;
}
export function decodeActionRequest(json: unknown): ActionRequest { return decode(json, parseActionRequest); }
