import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  vite:()=>({build:{minify:false}}),
  alias: { '@wisp/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.mts', import.meta.url)) },
  manifest: {
    name: 'Wisp Development',
    minimum_chrome_version: '125',
    permissions: ['sidePanel','tabs','storage','debugger'],
    optional_host_permissions:['http://*/*','https://*/*'],
    action: { default_title: '打开 Wisp' },
  },
});
