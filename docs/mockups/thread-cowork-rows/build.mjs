// Builds docs/mockups/ledge-thread-cowork-rows.html: the rows the « Cowork » mockup did not draw (messages between agents,
// notices, OpenRig, tasks), before and after their alignment on the new thread (#41, the owner's choice A of 2026-11-27).
// It builds the REAL Desktop of feat/thread-cowork, so run it from a checkout of that branch (or of main once #41 is merged),
// with this folder copied in: node docs/mockups/thread-cowork-rows/build.mjs   (OUT=<path> to write elsewhere)
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
const out = await mkdtemp(path.join(tmpdir(), 'ledge-thread-cowork-rows-'));
await build({
  configFile: false, root, base: './', logLevel: 'warn',
  // The e2e build's stand-ins (the shell that echoes, the short reconnect backoff): nothing here reaches a real machine.
  define: { 'import.meta.env.VITE_LEDGE_E2E': '"1"' },
  resolve: { alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } },
  plugins: [mockup, react(), tailwind()],
  build: { outDir: out, emptyOutDir: true, target: 'es2022', minify: !process.env.MOCKUP_DEBUG, assetsInlineLimit: 1_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
});
let html = await readFile(path.join(out, 'index.html'), 'utf8');
for (const asset of await readdir(path.join(out, 'assets'))) {
  const content = await readFile(path.join(out, 'assets', asset), 'utf8');
  if (asset.endsWith('.js')) html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '<script type="module">' + content.replaceAll('</script', '<\\/script') + '</script>');
  if (asset.endsWith('.css')) html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/, () => '<style>' + content + '</style>');
}
const target = process.env.OUT ?? path.resolve(root, '../ledge-thread-cowork-rows.html');
await writeFile(target, html);
console.log(target);
