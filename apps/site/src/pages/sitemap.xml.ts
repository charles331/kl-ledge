import type { APIRoute } from 'astro';
import { site } from '../config.ts';
import { localeList, locales } from '../i18n/index.ts';

const absolute = (path: string) => new URL(path, site.url).href;

/** Lists each language's page for search engines, each with its language alternates, so they index both and show the
 *  visitor the one in their language. */
export const GET: APIRoute = () => {
  const alternates = localeList
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${absolute(locales[l].path)}"/>`)
    .join('\n');
  const urls = localeList
    .map(l => `  <url>\n    <loc>${absolute(locales[l].path)}</loc>\n${alternates}\n  </url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
