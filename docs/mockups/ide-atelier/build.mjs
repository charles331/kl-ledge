// Builds the Atelier mockup into one file that opens offline (docs/mockups/ledge-ide-atelier.html): Desktop's real IDE, on a
// daemon simulated in the page (./daemon.ts), with the Atelier skin (./atelier.css) laid over the app's own stylesheets.
// Run: node docs/mockups/ide-atelier/build.mjs   (MOCKUP_DEBUG=1: not minified, to read a stack)
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(root, '../../../apps/desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const { build } = await import(require.resolve('vite'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));

const entry = path.join(desktop, 'src/main.tsx');
// A bare import from this folder resolves as Desktop's own do.
const mockup = {
  name: 'ledge-mockup', enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer) return null;
    const bare = !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0');
    if (bare && importer.split('?')[0].startsWith(root + path.sep)) return this.resolve(source, entry, { skipSelf: true });
    return null;
  }
};
// What the skin needs that a stylesheet cannot give: in the explorer, « À toi » (the catalogue's own `side.yours`) on a session that
// waits. It is an edit of Tree.tsx's agent row, made on the bundle only and shown under the skin only (`.at-on` / `.at-off`); a
// missing anchor fails the build rather than dropping the edit silently.
const tree = path.join(desktop, 'src/shell/sidebar/Tree.tsx');
const EDITS = [
  ['{s.offline ? t.side.offline : shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span>',
    '{waiting && !helper && !s.offline ? <><span className="at-on at-tag">{t.side.yours}</span><span className="at-off">{shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span></> : s.offline ? t.side.offline : shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span>']
];
const explorer = {
  name: 'ledge-atelier-explorer', enforce: 'pre',
  transform(code, id) {
    if (id.split('?')[0] !== tree) return null;
    for (const [from, to] of EDITS) { if (!code.includes(from)) throw new Error('Tree.tsx changed: anchor not found: ' + from.slice(0, 60)); code = code.replace(from, to); }
    return { code, map: null };
  }
};
const out = await mkdtemp(path.join(tmpdir(), 'ledge-ide-atelier-'));
await build({
  configFile: false, root, base: './', logLevel: 'warn',
  // The e2e build's stand-ins (the shell that echoes, the short reconnect backoff): nothing here reaches a real machine.
  define: { 'import.meta.env.VITE_LEDGE_E2E': '"1"' },
  resolve: { alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } },
  plugins: [mockup, explorer, react(), tailwind()],
  build: { outDir: out, emptyOutDir: true, target: 'es2022', minify: !process.env.MOCKUP_DEBUG, assetsInlineLimit: 1_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
});
let html = await readFile(path.join(out, 'index.html'), 'utf8');
for (const asset of await readdir(path.join(out, 'assets'))) {
  const content = await readFile(path.join(out, 'assets', asset), 'utf8');
  if (asset.endsWith('.js')) html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '<script type="module">' + content.replaceAll('</script', '<\\/script') + '</script>');
  if (asset.endsWith('.css')) html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/, () => '<style>' + content + '</style>');
}
const target = path.resolve(root, '../ledge-ide-atelier.html');
await writeFile(target, html);
console.log(target);
