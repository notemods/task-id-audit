import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
import type TaskIdAuditPlugin from '../../src/main';
import type { Report } from '../../src/audit';

const ROOT = 'Task ID Audit/Projects';
async function state(): Promise<Report | null> {
 return browser.executeObsidian(({ app }, id) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
  return p.modal?.report ?? null;
 }, pluginId);
}
async function open(folder: string): Promise<void> {
 await browser.executeObsidian(({ app }, id, value) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
  p.openAudit(value);
 }, pluginId, folder);
 await browser.waitUntil(async () => (await state()) !== null, { timeout: 15000, timeoutMsg: 'Audit did not finish' });
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

describe('Task ID Audit real app', function () {
 beforeEach(async () => { await setPro(false); });
 afterEach(async () => {
  await browser.executeObsidian(({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   p.modal?.close(); p.pro!.signOut();
  }, pluginId);
 });
 it('loads and reloads without errors', async () => {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 it('runs the free command and retains duplicate locations', async () => {
  await browser.executeObsidianCommand(`${pluginId}:open-audit`);
  await browser.waitUntil(async () => (await state()) !== null, { timeout: 15000 });
  const r = (await state())!;
  expect(r.complete).toBe(true);
  expect(r.issues.find((i) => i.kind === 'duplicate')?.sources).toEqual([
   { path: 'Task ID Audit/Archive/Previous release.md', line: 3 },
   { path: `${ROOT}/Duplicates/Release.md`, line: 5 },
  ]);
  expect(r.issues.find((i) => i.kind === 'ambiguous')?.ids).toEqual(['review_1']);
  expect(r.issues.find((i) => i.kind === 'missing')?.ids).toEqual(['missing_package']);
  expect(r.issues.find((i) => i.kind === 'self')?.ids).toEqual(['own_check']);
  expect(r.issues.find((i) => i.kind === 'cycle')?.ids).toEqual(['draft', 'publish', 'review']);
 });
 it('keeps the archive index with a project folder filter', async () => {
  await open(`${ROOT}/Resolved`);
  const r = (await state())!;
  expect(r.complete).toBe(true); expect(r.issues).toEqual([]); expect(r.tasks).toBe(11);
  expect(await browser.$('.task-id-audit-status').getText()).toBe('No findings in supported tasks');
 });
 it('opens a result in the editor at its physical line', async () => {
  await open(`${ROOT}/Targets`);
  const clicked = await browser.execute(() => {
   const button = [...document.querySelectorAll<HTMLButtonElement>('.task-id-audit-source')].find((b) => b.textContent?.endsWith('/Links.md:5'));
   button?.click(); return !!button;
  });
  expect(clicked).toBe(true);
  await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path?.endsWith('/Targets/Links.md') && app.workspace.activeEditor?.editor?.getCursor().line === 4), { timeout: 10000, timeoutMsg: 'Source line did not open' });
 });
 it('has stable reports and leaves source files unchanged', async () => {
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   const files = app.vault.getMarkdownFiles();
   const before = await Promise.all(files.map((f) => app.vault.cachedRead(f)));
   const a = await p.scan(), b = await p.scan();
   const after = await Promise.all(files.map((f) => app.vault.cachedRead(f)));
   return { stable: JSON.stringify(a) === JSON.stringify(b), unchanged: JSON.stringify(before) === JSON.stringify(after) };
  }, pluginId);
  expect(result).toEqual({ stable: true, unchanged: true });
 });
 it('excludes nested code and ignores fence text in comments', async () => {
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   const file = await app.vault.create('E2E code boundaries.md', ['<!--', '```', '-->', '- ```md', '  - [ ] Hidden 🆔 guard1', '  ```', '- [ ] Real 🆔 guard1'].join('\n'));
   try { const r = await p.scan(); return { tasks: r.tasks, guardIssues: r.issues.filter((i) => i.ids.includes('guard1')).length }; }
   finally { await app.vault.delete(file); }
  }, pluginId);
  expect(result).toEqual({ tasks: 12, guardIssues: 0 });
 });
 it('guards storage while free and persists Pro profiles and reports', async () => {
  await open(`${ROOT}/Cycles`);
  const free = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   return [await p.saveProfile('E2E project', 'Task ID Audit/Projects/Cycles'), await p.saveReport('E2E snapshot', p.modal!.report!)];
  }, pluginId);
  expect(free).toEqual([false, false]);
  await setPro(true);
  const saved = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   const profile = await p.saveProfile('E2E project', p.modal!.folder);
   const report = await p.saveReport('E2E snapshot', p.modal!.report!);
   await p.loadSettings(); p.modal!.updatePro();
   return { profile, report, folder: p.settings.profiles.find((s) => s.name === 'E2E project')?.folder, text: p.settings.reports[0]?.text };
  }, pluginId);
  expect(saved.profile).toBe(true); expect(saved.report).toBe(true); expect(saved.folder).toBe(`${ROOT}/Cycles`); expect(saved.text).toContain('Dependency cycle');
 });
 it('repeats after an archive target changes and stops after sign out', async () => {
  await setPro(true); await open(`${ROOT}/Targets`);
  expect((await state())!.issues.some((i) => i.kind === 'missing')).toBe(true);
  const path = 'Task ID Audit/Archive/Previous release.md';
  const old = await browser.executeObsidian(async ({ app }, id, path) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!;
   p.modal!.live = true; p.modal!.updatePro();
   const file = app.vault.getFileByPath(path)!; const before = await app.vault.cachedRead(file);
   await app.vault.modify(file, before + '\n- [x] Supply package 🆔 missing_package\n'); return before;
  }, pluginId, path);
  try {
   await browser.waitUntil(async () => !(await state())?.issues.some((i) => i.ids.includes('missing_package')), { timeout: 15000, timeoutMsg: 'Archive target did not trigger repeat audit' });
   await setPro(false);
   const live = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, TaskIdAuditPlugin> } }).plugins.plugins[id]!.modal!.live, pluginId);
   expect(live).toBe(false);
  } finally {
   await browser.executeObsidian(async ({ app }, path, text) => { await app.vault.modify(app.vault.getFileByPath(path)!, text); }, path, old);
  }
 });
});
