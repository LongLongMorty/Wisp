import { PROTOCOL_VERSION, object, text, integer, choice, utc, list, unique, fail, decode, sized } from './validation.mts';
import { parseTarget, parseCondition } from './actions.mts';
import type { Target, Condition } from './actions.mts';
import { ACTION_KINDS, parseObservation, parseActionResult, parseVerification, parseError } from './observation.mts';
import type { Observation, ActionKind, ActionResult, Verification, ErrorInfo } from './observation.mts';
import { parseState, parseUsage, parseBudget, parseConfirmation, parseRunLimits, parseRunSnapshot } from './runtime.mts';
import type { Usage, Budget, ConfirmationRequest, RunLimits, RunSnapshot } from './runtime.mts';
export type MessageSource = 'ui' | 'page';
type WireBase = {
    version: typeof PROTOCOL_VERSION;
    requestId: string;
};
type Control = 'run.get' | 'run.pause' | 'run.resume' | 'run.cancel';
export type PageInput = {
    documentId: string;
    frameId: string;
    kind: 'pointer' | 'keyboard' | 'navigation';
    timestamp: string;
};
export type RequestMessage = WireBase & ({
    type: 'run.start';
    runId?: never;
    payload: {
        tabId: number;
        goal: string;
        completionConditions?: Condition[];
        schemaIds?: string[];
        limits?: RunLimits;
    };
} | {
    type: Control;
    runId: string;
    payload: Record<string, never>;
} | {
    type: 'run.confirm';
    runId: string;
    payload: {
        confirmationId: string;
        decision: 'approve' | 'reject';
    };
} | {
    type: 'events.subscribe';
    runId: string;
    payload: {
        afterSeq: number;
    };
} | {
    type: 'page.observation';
    runId: string;
    payload: {
        observation: Observation;
    };
} | {
    type: 'page.input';
    runId: string;
    payload: PageInput;
});
export type RequestType = RequestMessage['type'];
const REQUEST_TYPES = ['run.start', 'run.get', 'run.pause', 'run.resume', 'run.cancel', 'run.confirm', 'events.subscribe', 'page.observation', 'page.input'] as const;
export function parseRequest(v: unknown, source: MessageSource): RequestMessage {
    choice(source, ['ui', 'page'], 'source');
    object(v, ['version', 'requestId', 'type', 'payload'], ['runId'], 'request');
    const base = { version: choice(v.version, [PROTOCOL_VERSION], 'request.version'), requestId: text(v.requestId, 'request.requestId') };
    const type = choice(v.type, REQUEST_TYPES, 'request.type');
    if (type.startsWith('page.') !== (source === 'page'))
        fail('request.source');
    if (type === 'run.start') {
        if (Object.hasOwn(v, 'runId'))
            fail('request.runId');
        object(v.payload, ['tabId', 'goal'], ['schemaIds', 'limits', 'completionConditions'], 'payload');
        const payload: {
            tabId: number;
            goal: string;
        completionConditions?: Condition[];
            schemaIds?: string[];
            limits?: RunLimits;
        } = { tabId: integer(v.payload.tabId, 'payload.tabId'), goal: text(v.payload.goal, 'payload.goal', 8000) };
        if (Object.hasOwn(v.payload, 'schemaIds'))
            payload.schemaIds = unique(list(v.payload.schemaIds, item => text(item, 'schemaId'), 'schemaIds', 16), 'schemaIds');
        if (Object.hasOwn(v.payload, 'limits'))
            payload.limits = parseRunLimits(v.payload.limits);
        if(Object.hasOwn(v.payload,'completionConditions')) { payload.completionConditions=list(v.payload.completionConditions,parseCondition,'payload.completionConditions',16);if(payload.completionConditions.some(c=>c.kind==='value'))fail('payload.completionConditions'); }
        return sized({ ...base, type, payload }, 'request.size');
    }
    const runId = text(v.runId, 'request.runId');
    switch (type) {
        case 'run.get':
        case 'run.pause':
        case 'run.resume':
        case 'run.cancel':
            object(v.payload, [], [], 'payload');
            return { ...base, type, runId, payload: {} };
        case 'run.confirm':
            object(v.payload, ['confirmationId', 'decision'], [], 'payload');
            return { ...base, type, runId, payload: { confirmationId: text(v.payload.confirmationId, 'confirmationId'), decision: choice(v.payload.decision, ['approve', 'reject'], 'decision') } };
        case 'events.subscribe':
            object(v.payload, ['afterSeq'], [], 'payload');
            return { ...base, type, runId, payload: { afterSeq: integer(v.payload.afterSeq, 'afterSeq') } };
        case 'page.observation':
            object(v.payload, ['observation'], [], 'payload');
            return sized({ ...base, type, runId, payload: { observation: parseObservation(v.payload.observation) } }, 'request.size');
        case 'page.input':
            object(v.payload, ['documentId', 'frameId', 'kind', 'timestamp'], [], 'payload');
            return { ...base, type, runId, payload: { documentId: text(v.payload.documentId, 'documentId'), frameId: text(v.payload.frameId, 'frameId'), kind: choice(v.payload.kind, ['pointer', 'keyboard', 'navigation'], 'input.kind'), timestamp: utc(v.payload.timestamp, 'input.timestamp') } };
    }
}
export function decodeRequest(json: unknown, source: MessageSource): RequestMessage { return decode(json, value => parseRequest(value, source)); }
type EventBase = {
    version: typeof PROTOCOL_VERSION;
    eventId: string;
    runId: string;
    seq: number;
    timestamp: string;
};
export type PreparedAction = {
    stepId: string;
    actionId: string;
} & ({
    kind: 'click' | 'fill' | 'pressKey' | 'selectOption';
    target: Target;
} | {
    kind: 'scroll' | 'navigate';
    target?: never;
});
export type ModelCompleted = {
    stepId: string;
    usage?: Usage;
    providerRequestId?: string;
};
export type RedactedEvent = {
    type: 'run.state' | 'step.observed' | 'action.prepared' | 'action.result' | 'verification.result' | 'confirmation.required';
    payload: {
        redacted: true;
        summary: string;
        stepId: string;
        actionId?: string;
        status?: import('./runtime.mts').RunState;
    };
};
export type RuntimeEvent = EventBase & (RedactedEvent | {
    type: 'run.state';
    payload: ReturnType<typeof parseState>;
} | {
    type: 'step.observed';
    payload: {
        stepId: string;
        observation: Observation;
    };
} | {
    type: 'model.completed';
    payload: ModelCompleted;
} | {
    type: 'action.prepared';
    payload: PreparedAction;
} | {
    type: 'action.result';
    payload: {
        stepId: string;
        result: ActionResult;
    };
} | {
    type: 'confirmation.required';
    payload: {
        stepId: string;
        confirmation: ConfirmationRequest;
    };
} | {
    type: 'verification.result';
    payload: {
        stepId: string;
        verification: Verification;
    };
} | {
    type: 'budget.updated';
    payload: {
        budget: Budget;
    };
});
const EVENT_TYPES = ['run.state', 'step.observed', 'model.completed', 'action.prepared', 'action.result', 'confirmation.required', 'verification.result', 'budget.updated'] as const;
export function parseEvent(v: unknown): RuntimeEvent {
    object(v, ['version', 'eventId', 'runId', 'seq', 'timestamp', 'type', 'payload'], [], 'event');
    const base = { version: choice(v.version, [PROTOCOL_VERSION], 'event.version'), eventId: text(v.eventId, 'event.id'), runId: text(v.runId, 'event.runId'), seq: integer(v.seq, 'event.seq', 1), timestamp: utc(v.timestamp, 'event.timestamp') };
    const type = choice(v.type, EVENT_TYPES, 'event.type');
    if (v.payload && typeof v.payload === 'object' && Object.getOwnPropertyDescriptor(v.payload,'redacted')?.value === true) {
        const metadataType = choice(type, ['run.state', 'step.observed', 'action.prepared', 'action.result', 'verification.result', 'confirmation.required'], 'event.redacted.type');
        object(v.payload, ['redacted', 'summary', 'stepId'], ['actionId', 'status'], 'payload');
        const metadata = v.payload as Record<string, unknown>;
        const payload: RedactedEvent['payload'] = { redacted: true, summary: text(metadata.summary, 'summary', 128), stepId: text(metadata.stepId, 'stepId') };
        if (Object.hasOwn(v.payload, 'actionId'))
            payload.actionId = text(metadata.actionId, 'actionId');
        if (Object.hasOwn(v.payload, 'status')) {
            if (type !== 'run.state')
                fail('event.redacted.status');
            payload.status = choice(metadata.status, ['created', 'running', 'waiting_user', 'paused', 'completed', 'failed', 'cancelled'], 'status');
        }
        return sized({ ...base, type: metadataType, payload }, 'event.size');
    }
    let result: RuntimeEvent;
    switch (type) {
        case 'run.state':
            result = { ...base, type, payload: parseState(v.payload) };
            break;
        case 'step.observed':
            object(v.payload, ['stepId', 'observation'], [], 'payload');
            result = { ...base, type, payload: { stepId: text(v.payload.stepId, 'stepId'), observation: parseObservation(v.payload.observation) } };
            break;
        case 'model.completed': {
            object(v.payload, ['stepId'], ['usage', 'providerRequestId'], 'payload');
            const payload: ModelCompleted = { stepId: text(v.payload.stepId, 'stepId') };
            if (Object.hasOwn(v.payload, 'usage'))
                payload.usage = parseUsage(v.payload.usage);
            if (Object.hasOwn(v.payload, 'providerRequestId'))
                payload.providerRequestId = text(v.payload.providerRequestId, 'providerRequestId');
            result = { ...base, type, payload };
            break;
        }
        case 'action.prepared': {
            object(v.payload, ['stepId', 'actionId', 'kind'], ['target'], 'payload');
            const kind = choice(v.payload.kind, ACTION_KINDS, 'prepared.kind');
            const needsTarget = ['click', 'fill', 'pressKey', 'selectOption'].includes(kind);
            if (needsTarget !== Object.hasOwn(v.payload, 'target'))
                fail('prepared.target');
            const metadata = { stepId: text(v.payload.stepId, 'stepId'), actionId: text(v.payload.actionId, 'actionId') };
            const payload: PreparedAction = needsTarget ? { ...metadata, kind: choice(kind, ['click', 'fill', 'pressKey', 'selectOption'], 'prepared.kind'), target: parseTarget(v.payload.target) } : { ...metadata, kind: choice(kind, ['scroll', 'navigate'], 'prepared.kind') };
            result = { ...base, type, payload };
            break;
        }
        case 'action.result':
            object(v.payload, ['stepId', 'result'], [], 'payload');
            result = { ...base, type, payload: { stepId: text(v.payload.stepId, 'stepId'), result: parseActionResult(v.payload.result) } };
            break;
        case 'confirmation.required': {
            object(v.payload, ['stepId', 'confirmation'], [], 'payload');
            const confirmation = parseConfirmation(v.payload.confirmation);
            const lifetime = Date.parse(confirmation.expiresAt) - Date.parse(base.timestamp);
            if (lifetime <= 0 || lifetime > 30000)
                fail('confirmation.lifetime');
            result = { ...base, type, payload: { stepId: text(v.payload.stepId, 'stepId'), confirmation } };
            break;
        }
        case 'verification.result':
            object(v.payload, ['stepId', 'verification'], [], 'payload');
            result = { ...base, type, payload: { stepId: text(v.payload.stepId, 'stepId'), verification: parseVerification(v.payload.verification) } };
            break;
        case 'budget.updated':
            object(v.payload, ['budget'], [], 'payload');
            result = { ...base, type, payload: { budget: parseBudget(v.payload.budget) } };
            break;
    }
    return sized(result, 'event.size');
}
export function decodeEvent(json: unknown): RuntimeEvent { return decode(json, parseEvent); }
export type ResponseMessage = WireBase & ({
    type: RequestType;
    ok: false;
    error: ErrorInfo;
    data?: never;
} | {
    type: 'run.start';
    ok: true;
    data: {
        runId: string;
    };
    error?: never;
} | {
    type: 'run.get';
    ok: true;
    data: RunSnapshot;
    error?: never;
} | {
    type: 'events.subscribe';
    ok: true;
    data: {
        events: RuntimeEvent[];
        nextSeq: number;
    };
    error?: never;
} | {
    type: 'run.pause' | 'run.resume' | 'run.cancel' | 'run.confirm' | 'page.observation' | 'page.input';
    ok: true;
    data: {
        accepted: true;
    };
    error?: never;
});
function responseValue(v: unknown, request: RequestMessage): ResponseMessage {
    object(v, ['version', 'requestId', 'type', 'ok'], ['data', 'error'], 'response');
    const base = { version: choice(v.version, [PROTOCOL_VERSION], 'response.version'), requestId: text(v.requestId, 'response.requestId') };
    const type = choice(v.type, REQUEST_TYPES, 'response.type');
    if (base.requestId !== request.requestId || type !== request.type)
        fail('response.correlation');
    if (v.ok === false) {
        object(v, ['version', 'requestId', 'type', 'ok', 'error'], [], 'response');
        return { ...base, type, ok: false, error: parseError(v.error) };
    }
    if (v.ok !== true)
        fail('response.ok');
    object(v, ['version', 'requestId', 'type', 'ok', 'data'], [], 'response');
    switch (type) {
        case 'run.start':
            object(v.data, ['runId'], [], 'response.data');
            return { ...base, type, ok: true, data: { runId: text(v.data.runId, 'response.runId') } };
        case 'run.get': {
            const data = parseRunSnapshot(v.data);
            if (data.runId !== request.runId)
                fail('response.runId');
            return { ...base, type, ok: true, data };
        }
        case 'events.subscribe': {
            if (request.type !== 'events.subscribe')
                fail('response.type');
            object(v.data, ['events', 'nextSeq'], [], 'response.data');
            const events = list(v.data.events, parseEvent, 'response.events', 100);
            let previous = request.payload.afterSeq;
            const eventIds = new Set<string>();
            for (const event of events) {
                if (event.runId !== request.runId || event.seq <= previous || eventIds.has(event.eventId))
                    fail('response.events.order');
                previous = event.seq;
                eventIds.add(event.eventId);
            }
            const nextSeq = integer(v.data.nextSeq, 'response.nextSeq');
            if (nextSeq !== previous)
                fail('response.nextSeq');
            return sized({ ...base, type, ok: true, data: { events, nextSeq } }, 'response.size');
        }
        default:
            object(v.data, ['accepted'], [], 'response.data');
            if (v.data.accepted !== true)
                fail('response.accepted');
            return { ...base, type, ok: true, data: { accepted: true } };
    }
}
export function parseResponse(v: unknown, request: RequestMessage): ResponseMessage { return sized(responseValue(v, request), 'response.size'); }
export function decodeResponse(json: unknown, request: RequestMessage): ResponseMessage { return decode(json, value => parseResponse(value, request)); }
