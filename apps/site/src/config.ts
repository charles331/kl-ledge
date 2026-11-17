// Everything the owner fills in by hand lives here: the links the page points to and the version it announces.
// A link left at `null` is not ready yet: the page then keeps the mockup's behaviour for it (see each field).

/** TODO(owner): the marker the approved mockup shows next to the Windows download until `downloadUrl` is filled in. */
export const DOWNLOAD_PLACEHOLDER = '[LIEN DE TÉLÉCHARGEMENT]';

export const site: {
  version: string;
  url: string;
  downloadUrl: string | null;
  githubUrl: string | null;
  guideUrl: string | null;
  releasesUrl: string | null;
  openrigUrl: string;
  installCommand: string;
  firstSessionCommand: string;
} = {
  /** The version the footer announces. `pnpm version:set` does not stamp this file: update it with each release. */
  version: '0.60.0',
  /** The public origin of the site, used for the canonical, `hreflang`, Open Graph and sitemap URLs. `SITE_URL` overrides
   *  it at build time (this file only runs at build time), for a preview served from another host. */
  url: process.env.SITE_URL ?? 'https://kl-ledge.dev',
  /** TODO(owner): the Ledge Desktop installer for Windows. While `null`, the button stays on the page and the marker above shows. */
  downloadUrl: null,
  /** The GitHub repository. While `null`, the footer link goes back to the top of the page, as in the mockup. */
  githubUrl: 'https://github.com/kl-ledge/ledge',
  /** TODO(owner): the guided tour (the user guide). While `null`, the footer link goes back to the top of the page. */
  guideUrl: null,
  /** The release notes behind « Nouveautés ». While `null`, the footer link goes back to the top of the page. */
  releasesUrl: 'https://github.com/kl-ledge/ledge/releases',
  openrigUrl: 'https://openrig.dev/',
  /** The commands are code, not copy: they read the same in every language. */
  installCommand: 'npm i -g @paradow/ledge && ledge setup',
  firstSessionCommand: 'ledge claude'
};
