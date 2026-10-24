import {runTool} from './tools.mjs';
await import('./runtime-build.mjs');
runTool('typescript','tsc',['-p','packages/sdk/tsconfig.json']);
