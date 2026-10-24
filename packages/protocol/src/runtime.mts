import { object, text, integer, numeric, boolean, choice, origin, utc, list, unique, fail, decode, jsonValue, sized } from './validation.mts';
import type { JsonValue } from './validation.mts';
import { parseActionRequest, parseCondition, parseTarget } from './actions.mts';
import type { ActionRequest, Condition, Target } from './actions.mts';
import { ACTION_KINDS, parseObservation, parseEvidence, parseError, parseCapabilities, parseActionResult, parseVerification } from './observation.mts';
import type { ActionKind, Observation, Evidence, ErrorInfo, Capabilities, ActionResult, Verification } from './observation.mts';
export type Decision = {
    kind: 'action';
    request: Omit<ActionRequest, 'actionId'>;
} | {
    kind: 'extract';
    schemaId: string;
} | {
    kind: 'finish';
    summary: string;
    expected: Condition[];
} | {
    kind: 'ask_user';
    question: string;
};
export type Usage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
};
export type ModelResponse = {
    decision: Decision;
    usage?: Usage;
    providerRequestId?: string;
};
export function parseDecision(v: unknown): Decision {
    object(v, ['kind'], ['request', 'schemaId', 'summary', 'expected', 'question'], 'decision');
    switch (v.kind) {
        case 'action': {
            object(v, ['kind', 'request'], [], 'decision');
            object(v.request, ['action', 'timeoutMs'], ['expected'], 'decision.request');
            const parsed = parseActionRequest({ ...v.request, actionId: 'schema-validation' });
            const { actionId, ...request } = parsed;
            return { kind: 'action', request };
        }
        case 'extract':
            object(v, ['kind', 'schemaId'], [], 'decision');
            return { kind: 'extract', schemaId: text(v.schemaId, 'decision.schemaId') };
        case 'finish':
            object(v, ['kind', 'summary', 'expected'], [], 'decision');
            return { kind: 'finish', summary: text(v.summary, 'decision.summary', 8000), expected: list(v.expected, parseCondition, 'decision.expected', 16, 1) };
        case 'ask_user':
            object(v, ['kind', 'question'], [], 'decision');
            return { kind: 'ask_user', question: text(v.question, 'decision.question', 2000) };
        default: fail('decision.kind');
    }
}
export function parseUsage(v: unknown): Usage {
    object(v, [], ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd'], 'usage');
    if (!Object.keys(v).length)
        fail('usage');
    const parsed: Usage = {};
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const)
        if (Object.hasOwn(v, key))
            parsed[key] = integer(v[key], 'usage.' + key);
    if (Object.hasOwn(v, 'costUsd'))
        parsed.costUsd = numeric(v.costUsd, 'usage.costUsd', 0, Number.MAX_VALUE);
    if (parsed.totalTokens !== undefined && parsed.totalTokens < (parsed.inputTokens ?? 0) + (parsed.outputTokens ?? 0))
        fail('usage.totalTokens');
    return parsed;
}
export function parseModelResponse(v: unknown): ModelResponse {
    object(v, ['decision'], ['usage', 'providerRequestId'], 'modelResponse');
    const parsed: ModelResponse = { decision: parseDecision(v.decision) };
    if (Object.hasOwn(v, 'usage'))
        parsed.usage = parseUsage(v.usage);
    if (Object.hasOwn(v, 'providerRequestId'))
        parsed.providerRequestId = text(v.providerRequestId, 'providerRequestId');
    return sized(parsed, 'modelResponse.size');
}
export function decodeModelResponse(json: unknown): ModelResponse { return decode(json, parseModelResponse); }
const COUNTERS = ['steps', 'modelCalls', 'elapsedMs', 'contextChars', 'observationChars', 'consecutiveNoProgress'] as const;
export type Counter = {
    used: number;
    limit: number;
};
export type Budget = Record<(typeof COUNTERS)[number], Counter>;
export function parseBudget(v: unknown): Budget {
    object(v, COUNTERS, [], 'budget');
    return Object.fromEntries(COUNTERS.map(key => { const c = v[key]; object(c, ['used', 'limit'], [], 'counter'); return [key, { used: integer(c.used, 'counter.used'), limit: integer(c.limit, 'counter.limit', 1) }]; })) as Budget;
}
const LIMITS = { maxSteps: 10000, maxDurationMs: 3600000, maxModelCalls: 10000, maxContextChars: 64000, maxObservationChars: 24000, maxConsecutiveNoProgress: 1000 } as const;
export type RunLimits = Partial<Record<keyof typeof LIMITS, number>>;
export function parseRunLimits(v: unknown): RunLimits {
    object(v, [], Object.keys(LIMITS), 'limits');
    const result: RunLimits = {};
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[])
        if (Object.hasOwn(v, key))
            result[key] = integer(v[key], 'limits.' + key, 1, LIMITS[key]);
    return result;
}
export type Extraction = {
    schemaId: string;
    data: JsonValue;
    source: Evidence[];
};
export type ExtractionResponse = Extraction & {
    usage?: Usage;
    providerRequestId?: string;
};
export function parseExtraction(v: unknown): Extraction {
    object(v, ['schemaId', 'data', 'source'], [], 'extraction');
    return { schemaId: text(v.schemaId, 'extraction.schemaId'), data: jsonValue(v.data), source: list(v.source, parseEvidence, 'extraction.source', 32, 1) };
}
export function parseExtractionResponse(v: unknown): ExtractionResponse {
    object(v, ['schemaId', 'data', 'source'], ['usage', 'providerRequestId'], 'extractionResponse');
    const result: ExtractionResponse = parseExtraction({ schemaId: v.schemaId, data: v.data, source: v.source });
    if (Object.hasOwn(v, 'usage'))
        result.usage = parseUsage(v.usage);
    if (Object.hasOwn(v, 'providerRequestId'))
        result.providerRequestId = text(v.providerRequestId, 'providerRequestId');
    return sized(result, 'extractionResponse.size');
}
export function decodeExtractionResponse(json: unknown): ExtractionResponse { return decode(json, parseExtractionResponse); }
export const RUN_STATES = ['created', 'running', 'waiting_user', 'paused', 'completed', 'failed', 'cancelled'] as const;
export type RunState = (typeof RUN_STATES)[number];
export type RunResult = ({
    status: 'completed';
    summary: string;
} & ({
    evidence: Evidence[];
    extraction?: Extraction;
} | {
    evidence?: Evidence[];
    extraction: Extraction;
})) | {
    status: 'failed';
    error: ErrorInfo;
} | {
    status: 'cancelled';
    reason: string;
};
export function parseRunResult(v: unknown): RunResult {
    object(v, ['status'], ['summary', 'evidence', 'extraction', 'error', 'reason'], 'runResult');
    switch (v.status) {
        case 'completed': {
            object(v, ['status', 'summary'], ['evidence', 'extraction'], 'runResult');
            const summary = text(v.summary, 'result.summary', 8000);
            if (Object.hasOwn(v, 'extraction')) {
                const result: {
                    status: 'completed';
                    summary: string;
                    extraction: Extraction;
                    evidence?: Evidence[];
                } = { status: 'completed', summary, extraction: parseExtraction(v.extraction) };
                if (Object.hasOwn(v, 'evidence'))
                    result.evidence = list(v.evidence, parseEvidence, 'result.evidence', 32);
                return result;
            }
            return { status: 'completed', summary, evidence: list(v.evidence, parseEvidence, 'result.evidence', 32, 1) };
        }
        case 'failed':
            object(v, ['status', 'error'], [], 'runResult');
            return { status: 'failed', error: parseError(v.error) };
        case 'cancelled':
            object(v, ['status', 'reason'], [], 'runResult');
            return { status: 'cancelled', reason: text(v.reason, 'result.reason', 2048) };
        default: fail('runResult.status');
    }
}
export type StateOutcome = {
    status: 'created' | 'running' | 'waiting_user' | 'paused';
    result?: never;
} | {
    status: 'completed';
    result: Extract<RunResult, {
        status: 'completed';
    }>;
} | {
    status: 'failed';
    result: Extract<RunResult, {
        status: 'failed';
    }>;
} | {
    status: 'cancelled';
    result: Extract<RunResult, {
        status: 'cancelled';
    }>;
};
export type RunSnapshot = {
    runId: string;
    tabId: number;
    goal: string;
    updatedAt: string;
} & StateOutcome;
export function parseState(v: unknown): StateOutcome & {
    reason?: string;
} {
    object(v, ['status'], ['reason', 'result'], 'state');
    const status = choice(v.status, RUN_STATES, 'state.status');
    const explanation = Object.hasOwn(v, 'reason') ? { reason: text(v.reason, 'state.reason', 2048) } : {};
    const terminal = ['completed', 'failed', 'cancelled'].includes(status);
    if (terminal !== Object.hasOwn(v, 'result'))
        fail('state.result');
    if (!terminal)
        return { status: choice(status, ['created', 'running', 'waiting_user', 'paused'], 'state.status'), ...explanation };
    const result = parseRunResult(v.result);
    if (result.status !== status)
        fail('state.result.status');
    switch (result.status) {
        case 'completed': return { status: 'completed', result, ...explanation };
        case 'failed': return { status: 'failed', result, ...explanation };
        case 'cancelled': return { status: 'cancelled', result, ...explanation };
    }
}
export function parseRunSnapshot(v: unknown): RunSnapshot {
    object(v, ['runId', 'tabId', 'goal', 'status', 'updatedAt'], ['result'], 'snapshot');
    const stateInput: Record<string, unknown> = { status: v.status };
    if (Object.hasOwn(v, 'result'))
        stateInput.result = v.result;
    const state = parseState(stateInput);
    const base = { runId: text(v.runId, 'snapshot.runId'), tabId: integer(v.tabId, 'snapshot.tabId'), goal: text(v.goal, 'snapshot.goal', 8000), updatedAt: utc(v.updatedAt, 'snapshot.updatedAt') };
    switch (state.status) {
        case 'completed': return { ...base, status: 'completed', result: state.result };
        case 'failed': return { ...base, status: 'failed', result: state.result };
        case 'cancelled': return { ...base, status: 'cancelled', result: state.result };
        default: return { ...base, status: state.status };
    }
}
export type ConfirmationRequest = {
    confirmationId: string;
    actionId: string;
    origin: string;
    documentId: string;
    targetFingerprint: string;
    contextDigest: string;
    summary: string;
    displayParameters: Record<string, string>;
    expiresAt: string;
};
export function parseConfirmation(v: unknown): ConfirmationRequest {
    object(v, ['confirmationId', 'actionId', 'origin', 'documentId', 'targetFingerprint', 'contextDigest', 'summary', 'displayParameters', 'expiresAt'], [], 'confirmation');
    const digest = text(v.contextDigest, 'confirmation.contextDigest', 64);
    if (!/^[a-f0-9]{64}$/i.test(digest))
        fail('confirmation.contextDigest');
    const params = v.displayParameters;
    if (!params || typeof params !== 'object')
        fail('confirmation.displayParameters');
    const keys = Object.keys(params);
    if (keys.length > 32)
        fail('confirmation.displayParameters');
    object(params, keys, [], 'confirmation.displayParameters');
    const displayParameters = Object.fromEntries(keys.map(key => { text(key, 'parameter.key', 64); if (['__proto__', 'constructor', 'prototype'].includes(key))
        fail('parameter.key'); return [key, text(params[key], 'parameter.value', 2048, true)]; }));
    return { confirmationId: text(v.confirmationId, 'confirmation.id'), actionId: text(v.actionId, 'confirmation.actionId'), origin: origin(v.origin, 'confirmation.origin'), documentId: text(v.documentId, 'confirmation.documentId'), targetFingerprint: text(v.targetFingerprint, 'confirmation.targetFingerprint'), contextDigest: digest, summary: text(v.summary, 'confirmation.summary', 2048), displayParameters, expiresAt: utc(v.expiresAt, 'confirmation.expiresAt') };
}
export type DecisionInput = {
    goal: string;
    observation: Observation;
    historySummary: string;
    allowedActions: ActionKind[];
    schemaIds: string[];
    completionConditions?: Condition[];
    budget: Budget;
};
export function parseDecisionInput(v: unknown): DecisionInput {
    object(v, ['goal', 'observation', 'historySummary', 'allowedActions', 'schemaIds', 'budget'], ['completionConditions'], 'decisionInput');
    return { goal: text(v.goal, 'input.goal', 8000), observation: parseObservation(v.observation), historySummary: text(v.historySummary, 'input.historySummary', 8000, true), allowedActions: unique(list(v.allowedActions, item => choice(item, ACTION_KINDS, 'allowedAction'), 'allowedActions', 6, 1), 'allowedActions'), ...(Object.hasOwn(v,'completionConditions')?{completionConditions:list(v.completionConditions,parseCondition,'input.completionConditions',16)}:{}), schemaIds: unique(list(v.schemaIds, item => text(item, 'schemaId'), 'schemaIds', 16), 'schemaIds'), budget: parseBudget(v.budget) };
}
export type ExtractionInput = {
    observation: Observation;
    schemaId: string;
    schema: JsonValue;
};
export function parseExtractionInput(v: unknown): ExtractionInput {
    object(v, ['observation', 'schemaId', 'schema'], [], 'extractionInput');
    return { observation: parseObservation(v.observation), schemaId: text(v.schemaId, 'input.schemaId'), schema: jsonValue(v.schema) };
}
export interface BrowserAdapter {
    capabilities(): Promise<Capabilities>;
    observe(signal?: AbortSignal): Promise<Observation>;
    execute(request: ActionRequest, signal?: AbortSignal): Promise<ActionResult>;
    verify(conditions: Condition[], signal?: AbortSignal): Promise<Verification>;
    dispose(): Promise<void>;
}
export interface ModelProvider {
    decide(input: DecisionInput, signal?: AbortSignal): Promise<ModelResponse>;
    extract(input: ExtractionInput, signal?: AbortSignal): Promise<ExtractionResponse>;
}
