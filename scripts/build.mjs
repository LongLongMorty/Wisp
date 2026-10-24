import { runTool, extension } from './tools.mjs';
await import('./protocol-build.mjs');
await import('./browser-build.mjs');
await import('./policy-build.mjs');
await import('./runtime-build.mjs');
await import('./models-build.mjs');
await import('./sdk-build.mjs');
runTool('wxt','wxt',['build','--browser','chrome'],extension);
await import('./verify-build.mjs');
