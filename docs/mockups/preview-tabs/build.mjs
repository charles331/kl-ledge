// Standalone mockup (spec 2026-11-26-preview-tabs-design.md §5.5): the preview tab of Ledge Desktop, its title in italic.
// The real DockHost (dockview, PanelTab, the strip's tools) and SessionTabLabel on a mockup workspace, with Desktop's
// stylesheets, inlined into one file.
// `node docs/mockups/preview-tabs/build.mjs` writes docs/mockups/ledge-preview-tabs.html.
// Needs this worktree's node_modules (pnpm install); Geist comes from Google Fonts, as in apps/desktop/index.html. esbuild
// bundles the script; Vite and Tailwind only compile the stylesheet.
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const desktop = createRequire(resolve(root, 'apps/desktop/package.json'));
const { build: vite } = await import(desktop.resolve('vite'));
const { default: tailwind } = await import(desktop.resolve('@tailwindcss/vite'));
const { build: esbuild } = createRequire(desktop.resolve('vite'))('esbuild');

const js = await esbuild({
  entryPoints: [resolve(here, 'mockup.tsx')], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
  nodePaths: [resolve(root, 'apps/desktop/node_modules'), resolve(root, 'node_modules')],
  define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}', 'process.env.NODE_ENV': '"production"' }, minify: true, loader: { '.css': 'empty' }
});

const out = await mkdtemp(join(tmpdir(), 'ledge-preview-tabs-'));
const page = join(here, 'index.html');
await writeFile(page, '<!doctype html><html><head></head><body><script type="module" src="./css-entry.ts"></script></body></html>');
try {
  await vite({ configFile: false, root: here, base: './', logLevel: 'warn', plugins: [tailwind()], build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false, minify: true } });
} finally { await rm(page, { force: true }); }
const css = (await Promise.all((await readdir(join(out, 'assets'))).filter(a => a.endsWith('.css')).map(a => readFile(join(out, 'assets', a), 'utf8')))).join('\n');
await rm(out, { recursive: true, force: true });

const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledge · onglets d’aperçu</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"><style>${css}</style></head><body><div id="root"></div><script type="module">${js.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, 'docs/mockups/ledge-preview-tabs.html');
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html) }));
