import { parseActionRequest, ProtocolError } from '../src/index.mts';
import type { ActionRequest, BrowserAction, Target } from '../src/index.mts';
const target = { documentId:'d', frameId:'f', observationId:'o', ref:'r' } satisfies Target;
const request: ActionRequest = parseActionRequest({ actionId:'a', action:{kind:'click',target}, timeoutMs:10000 });
const code: 'MODEL_INVALID_OUTPUT' = new ProtocolError('test').code;
// @ts-expect-error A target cannot omit its document scope.
const incomplete: Target = { frameId:'f', observationId:'o', ref:'r' };
// @ts-expect-error Arbitrary script evaluation is not a browser action.
const executable: BrowserAction = { kind:'evaluate', script:'alert(1)' };
void [request,code,incomplete,executable];

import type {RequestMessage,RuntimeEvent,ResponseMessage,BrowserAdapter,ModelProvider} from '../src/index.mts';
// @ts-expect-error New tasks cannot carry an existing runId.
const forgedStart: RequestMessage = {version:'0.1',requestId:'q',type:'run.start',runId:'r',payload:{tabId:1,goal:'go'}};
// @ts-expect-error Event payloads must correspond to the event type.
const wrongEvent: RuntimeEvent = {version:'0.1',eventId:'e',runId:'r',seq:1,timestamp:'2026-10-18T00:00:00Z',type:'budget.updated',payload:{stepId:'s'}};
// @ts-expect-error Response success and error fields are mutually exclusive.
const mixedResponse: ResponseMessage = {version:'0.1',requestId:'q',type:'run.cancel',ok:true,data:{accepted:true},error:{code:'TIMEOUT',message:'timeout',retryable:true}};
declare const browserAdapter: BrowserAdapter;
declare const modelProvider: ModelProvider;
void [forgedStart,wrongEvent,mixedResponse,browserAdapter,modelProvider];

import type {PreparedAction,RunSnapshot} from '../src/index.mts';
// @ts-expect-error Targeted actions must retain their target identity.
const missingTarget: PreparedAction = {stepId:'s',actionId:'a',kind:'click'};
// @ts-expect-error Completed snapshots must include a completed result.
const incompleteSnapshot: RunSnapshot = {runId:'r',tabId:1,goal:'go',updatedAt:'2026-10-18T00:00:00Z',status:'completed'};
// @ts-expect-error Terminal state events cannot omit their result.
const incompleteTerminal: RuntimeEvent = {version:'0.1',eventId:'e',runId:'r',seq:1,timestamp:'2026-10-18T00:00:00Z',type:'run.state',payload:{status:'completed'}};
void [missingTarget,incompleteSnapshot,incompleteTerminal];
