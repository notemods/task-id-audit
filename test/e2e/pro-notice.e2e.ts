import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type TaskIdAuditPlugin from '../../src/main';

// A free user opens the audit from the command palette and selects "Repeat after file changes (Pro)". The shared
// Pro notice must show, with a Sponsor on GitHub button that opens the Sponsors page with metadata_source=<plugin id>.
// Repeat stays off. A Pro user (simulated Sponsors check) turns Repeat on and gets no notice.
const LEAD = 'Repeat after file changes is a Pro feature.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const TOGGLE = '.task-id-audit-modal .task-id-audit-pro .setting-item:first-child .checkbox-container';

interface Shown { text: string; buttons: number }
async function notices(): Promise<Shown[]> {
 return browser.execute(() => [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
}
async function clearNotices(): Promise<void> {
 await browser.execute(() => { for (const doc of new Set([document, (window as unknown as { activeWindow: Window }).activeWindow.document])) doc.querySelectorAll('.notice').forEach((n) => n.remove()); });
}
async function setPro(value: boolean): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, on) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
  if (!on) { p.pro!.signOut(); return; }
  (p.pro as unknown as { opts: { http: unknown } }).opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
  app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
  await p.pro!.refreshNow();
 }, pluginId, value);
}
/** Live flag of the open modal, and the state of the Repeat toggle row. */
async function repeat(): Promise<{ live: boolean | null; enabled: boolean; disabled: boolean; name: string }> {
 const live = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!.modal?.live ?? null, pluginId);
 const row = await browser.execute((sel: string) => {
  const box = document.querySelector(sel);
  return { enabled: !!box?.classList.contains('is-enabled'), disabled: !!box?.classList.contains('is-disabled'), name: box?.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent ?? '' };
 }, TOGGLE);
 return { live, ...row };
}
async function openAudit(): Promise<void> {
 await browser.executeObsidianCommand(`${pluginId}:open-audit`);
 await browser.waitUntil(async () => (await browser.$(TOGGLE)).isExisting(), { timeout: 15000, timeoutMsg: 'The audit modal has no Repeat toggle.' });
}
async function closeAudit(): Promise<void> {
 await browser.executeObsidian(({ app }, id) => { (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!.modal?.close(); }, pluginId);
}

describe(`${pluginId} Pro notice`, function () {
 afterEach(async () => { await closeAudit(); await setPro(false); });

 it('shows the Sponsor on GitHub button when a free user selects Repeat after file changes', async () => {
  await setPro(false);
  await clearNotices();
  await openAudit();
  expect(await repeat()).toEqual({ live: false, enabled: false, disabled: false, name: 'Repeat after file changes (Pro)' });
  await (await browser.$(TOGGLE)).click();
  await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD)), { timeout: 5000 }).catch(async () => {
   throw new Error(`No Pro notice after the Repeat toggle: ${JSON.stringify({ repeat: await repeat(), notices: await notices() })}`);
  });
  const shown = (await notices()).filter((n) => n.text.includes(LEAD));
  expect(shown).toHaveLength(1);
  expect(shown[0]!.text).toContain(`${LEAD} ${PITCH}`);
  expect(shown[0]!.buttons).toBe(1);
  await browser.waitUntil(async () => !(await repeat()).enabled, { timeout: 5000, timeoutMsg: 'The Repeat toggle does not show off again.' });
  expect((await repeat()).live).toBe(false);
  // The button opens the Sponsors page. window.open is replaced for this click only, so no page opens.
  const url = await browser.execute(() => {
   const w = window as unknown as { open: (u?: string) => unknown; activeWindow: Window };
   const original = w.open;
   let opened = '';
   w.open = (u?: string) => { opened = u ?? ''; return null; };
   try { (w.activeWindow.document.querySelector('.notice .pf-pro-notice-sponsor') as HTMLElement).click(); } finally { w.open = original; }
   return opened;
  });
  expect(url).toBe(`https://github.com/sponsors/theluckystrike?metadata_source=${pluginId}`);
 });

 it('turns Repeat on for a Pro user with no notice (simulated Sponsors check)', async () => {
  await setPro(true);
  await clearNotices();
  await openAudit();
  await (await browser.$(TOGGLE)).click();
  await browser.waitUntil(async () => (await repeat()).live === true, { timeout: 5000, timeoutMsg: 'A Pro user could not turn on Repeat after file changes.' });
  expect((await notices()).filter((n) => n.text.includes(LEAD) || n.buttons > 0)).toHaveLength(0);
 });
});
