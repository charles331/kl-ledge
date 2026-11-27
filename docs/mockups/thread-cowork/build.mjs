// Builds the « Cowork » thread mockup into one file that opens offline (docs/mockups/ledge-thread-cowork.html): Desktop's real
// IDE under its Atelier skin, on a daemon simulated in the page (./daemon.ts), with the session
// thread and the reply field redrawn by this folder's files and dressed by ./cowork.css.
// Run: node docs/mockups/thread-cowork/build.mjs   (MOCKUP_DEBUG=1: not minified, to read a stack)
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
// The parts redrawn: every import of Desktop's Thread.tsx and SessionBar.tsx gets this folder's file of the same name, which takes
// the same props (and imports the real one from here, for « Aujourd'hui »).
const SWAPPED = ['Thread', 'SessionBar'];
const swap = {
  name: 'ledge-thread-cowork', enforce: 'pre',
  async resolveId(source, importer) {
    const name = SWAPPED.find(n => new RegExp(`(^|/)${n}(\\.tsx)?$`).test(source));
    if (!importer || !name || importer.split('?')[0].startsWith(root + path.sep)) return null;
    const hit = await this.resolve(source, importer, { skipSelf: true });
    return hit && hit.id.split('?')[0] === path.join(desktop, `src/session/${name}.tsx`) ? path.join(root, `${name}.tsx`) : null;
  }
};
// The reply field gets its bottom row (./Composer.tsx: the session bar's slot, the voice, send or interrupt), a placeholder
// that follows the field's mode, and a send that hands an aside to the mockup. Edits of Reply.tsx made on the bundle only; a
// missing anchor fails the build rather than dropping the edit silently.
const reply = path.join(desktop, 'src/session/Reply.tsx');
const REPLY_EDITS = [
  ['const submit = () => {', 'const submit = () => { if (!pending && takeBtw(session, text, () => setDraft(\'\'))) return;'],
  ['const name = session.name;', 'const name = session.name; const cwMode = useComposerMode(session.id);'],
  ['placeholder={placeholder}', 'placeholder={cwMode === \'voice\' ? \'Je vous écoute…\' : placeholder}'],
  ['</form>', '{ide && <Composer client={client} session={session} filled={!!text || withImages} shut={shut} btw={session.tool === \'claude\' && !pending && isBtw(draft)} ownStop={stoppable && client && !askCard ? stop : undefined} stopping={stopping} />}</form>']
];
const composer = {
  name: 'ledge-cowork-composer', enforce: 'pre',
  transform(code, id) {
    if (id.split('?')[0] !== reply) return null;
    for (const [from, to] of REPLY_EDITS) { if (!code.includes(from)) throw new Error('Reply.tsx changed: anchor not found: ' + from); code = code.replace(from, to); }
    const from = f => JSON.stringify(path.join(root, f));
    return { code: `import { Composer, useComposerMode } from ${from('Composer.tsx')};\nimport { isBtw, takeBtw } from ${from('composer.ts')};\n` + code, map: null };
  }
};
const out = await mkdtemp(path.join(tmpdir(), 'ledge-thread-cowork-'));
await build({
  configFile: false, root, base: './', logLevel: 'warn',
  // The e2e build's stand-ins (the shell that echoes, the short reconnect backoff): nothing here reaches a real machine.
  define: { 'import.meta.env.VITE_LEDGE_E2E': '"1"' },
  resolve: { alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } },
  plugins: [mockup, swap, composer, react(), tailwind()],
  build: { outDir: out, emptyOutDir: true, target: 'es2022', minify: !process.env.MOCKUP_DEBUG, assetsInlineLimit: 1_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
});
let html = await readFile(path.join(out, 'index.html'), 'utf8');
for (const asset of await readdir(path.join(out, 'assets'))) {
  const content = await readFile(path.join(out, 'assets', asset), 'utf8');
  if (asset.endsWith('.js')) html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '<script type="module">' + content.replaceAll('</script', '<\\/script') + '</script>');
  if (asset.endsWith('.css')) html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/, () => '<style>' + content + '</style>');
}
const target = path.resolve(root, '../ledge-thread-cowork.html');
await writeFile(target, html);
console.log(target);
