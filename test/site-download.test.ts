import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

// The site's download button names a release asset: the release workflow must publish an asset by that very name.
describe('the site download link', () => {
  it('points at an asset the release publishes under a name without the version', () => {
    const url = read('apps/site/src/config.ts').match(/downloadUrl: '([^']+)'/)?.[1];
    expect(url).toMatch(/^https:\/\/github\.com\/kl-ledge\/ledge\/releases\/latest\/download\/[^/]+$/);
    const asset = url!.split('/').pop()!;
    expect(asset).not.toMatch(/\d+\.\d+\.\d+/);
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain(`Join-Path $desktopSrc.DirectoryName '${asset}'`);
    expect(workflow).toMatch(/\$assets = @\([^)]*\$desktopLatest/);
  });
});
