import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// Settings › General › Default agent wears each harness's provider logo, as the launch dialog's agent cards do, not the
// robot mascots: one 16 px mark per choice, centred on its label, in both themes. The zoomed captures land in e2e/.results/.
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });

const PROVIDERS = [['Claude Code', 'Anthropic'], ['Codex', 'OpenAI'], ['Cursor Agent', 'Cursor'], ['OMP', 'omp']] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`Default agent: the provider logos, centred on their labels (${theme})`, async ({ page }, info) => {
    await seedAtelier(page);
    await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } }, [theme]);
    await fakeDaemon(page, eight, { projects: twoProjects });
    await page.goto('/');
    await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Control+Comma');
    const group = page.getByRole('radiogroup', { name: 'Default agent' });
    await expect(group).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(group.locator('.logo-bot')).toHaveCount(0);
    const labels = group.locator('label');
    await expect(labels).toHaveCount(PROVIDERS.length);
    for (const [i, [name, provider]] of PROVIDERS.entries()) {
      const label = labels.nth(i);
      await expect(label).toContainText(name);
      const logo = label.locator('.logo');
      await expect(logo).toHaveAttribute('title', provider);
      const mark = (await logo.locator('svg').boundingBox())!;
      expect(mark.width).toBe(16); expect(mark.height).toBe(16);
      // The label's text box, read from its text node: its middle and the mark's sit on the same line.
      const text = await label.evaluate(el => {
        const node = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())!;
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect(); return { top: r.top, height: r.height, left: r.left };
      });
      const box = (await label.boundingBox())!;
      expect(Math.abs((mark.y + mark.height / 2) - (text.top + text.height / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs((mark.y + mark.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
      // The mark comes before its name, 6 px apart (the segment's gap).
      expect(Math.round(text.left - (mark.x + mark.width))).toBe(6);
    }
    const row = page.locator('.set-row').filter({ has: group });
    await row.scrollIntoViewIfNeeded();
    await row.screenshot({ path: info.outputPath(`default-agent-${theme}.png`) });
    await group.screenshot({ path: info.outputPath(`default-agent-choices-${theme}.png`) });
  });
}
