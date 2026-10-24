import {runTool} from './tools.mjs';
await import('./protocol-build.mjs');
await import('./models-build.mjs');
runTool('typescript','tsc',['-p','packages/runtime/tsconfig.json']);
