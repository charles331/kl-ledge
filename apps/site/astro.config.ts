import { defineConfig } from 'astro/config';
import { site } from './src/config.ts';

// The site is fully static: two prerendered pages (English at `/`, French at `/fr/`) and the media in `public/`.
// English first lived at `/en/`: that address still answers and sends the visitor to the root.
export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
  redirects: { '/en/': '/' },
  devToolbar: { enabled: false }
});
