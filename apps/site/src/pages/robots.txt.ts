import type { APIRoute } from 'astro';
import { site } from '../config.ts';

/** Lets every crawler in and points it at the sitemap, which carries the site's own origin. */
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site.url).href}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
