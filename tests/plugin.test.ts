import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TaskIdAuditPlugin, { reportText } from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { audit } from '../src/audit';
import manifest from '../manifest.json';
afterEach(() => resetPro());
const make = () => new TaskIdAuditPlugin(App.createConfigured__({ files: { 'a.md': '- [ ] A 🆔 a' } }) as never, manifest as never);
describe('plugin and Pro', () => {
 it('loads defaults from the vault', async () => { const p = make(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); });
 it('repairs invalid settings', () => { expect(normalizeSettings({ profiles: 1, reports: [null, {}] })).toEqual(DEFAULT_SETTINGS); });
 it('uses the reference sponsorship terms', () => { expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 }); });
 it('blocks profile and report storage without Pro', async () => { const p = make(); const save = vi.spyOn(p, 'saveData'); expect(await p.saveProfile('Work', 'Projects')).toBe(false); expect(await p.saveReport('Work', audit([]))).toBe(false); expect(save).not.toHaveBeenCalled(); });
 it('saves profiles and bounded reports with Pro', async () => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const p = make(); p.settings = { profiles: [], reports: [] }; vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
  expect(isPro()).toBe(true); expect(await p.saveProfile('Work', 'Projects/')).toBe(true);
  expect(p.settings.profiles).toEqual([{ name: 'Work', folder: 'Projects' }]);
  for (let n = 0; n < 7; n++) await p.saveReport(String(n), audit([]));
  expect(p.settings.reports).toHaveLength(5); expect(p.settings.reports[0]!.name).toBe('6');
 });
 it('reads notes without modifying them', async () => { const p = make(); const before = await p.app.vault.cachedRead(p.app.vault.getMarkdownFiles()[0]!); expect(await p.scan()).toEqual(await p.scan()); expect(await p.app.vault.cachedRead(p.app.vault.getMarkdownFiles()[0]!)).toBe(before); });
 it('keeps source locations in stored report text', () => { expect(reportText(audit([{ path: 'a.md', text: '- [ ] A ⛔ gone' }]))).toContain('a.md:1'); });
});
