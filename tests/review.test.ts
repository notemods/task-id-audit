import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal } from 'obsidian-test-mocks/obsidian';
import TaskIdAuditPlugin, { AuditModal } from '../src/main';
import { audit, LIMITS, parseNote } from '../src/audit';
import { bindPro, resetPro } from '../src/pro';
import { normalizeSettings, TaskIdAuditSettingTab } from '../src/settings';
import manifest from '../manifest.json';

const make = (files = { 'a.md': '- [ ] A 🆔 a' }) => new TaskIdAuditPlugin(App.createConfigured__({ files }) as never, manifest as never);
const pro = () => bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('review regressions', () => {
 it('does not start an HTML comment inside inline code', () => {
  const r = audit([{ path: 'a.md', text: '- [ ] Explain `<!--` 🆔 a\n- [ ] Repeat 🆔 a' }]);
  expect(r.complete).toBe(true);
  expect(r.tasks).toBe(2);
  expect(r.issues[0]?.kind).toBe('duplicate');
 });
 it('does not mask a field between unequal backtick runs', () => {
  const r = audit([{ path: 'a.md', text: '- [ ] Literal `⛔ missing ``' }]);
  expect(r.issues[0]?.kind).toBe('missing');
 });
 it('excludes inline code that continues on the next physical line', () => {
  const r = audit([{ path: 'a.md', text: '- [ ] Explain `🆔 hidden\n  continued` 🆔 real\n- [ ] Other 🆔 hidden' }]);
  expect(r.issues).toEqual([]);
  expect(r.tasks).toBe(2);
 });
 it('does not let an unclosed quoted fence hide later ordinary tasks', () => {
  const p = parseNote({ path: 'a.md', text: '> ```md\n> - [ ] Hidden 🆔 a\n\n- [ ] Real 🆔 a' });
  expect(p.tasks.map((t) => [t.id, t.line])).toEqual([['a', 4]]);
 });
 it('does not open a backtick fence with a backtick in its info text', () => {
  const p = parseNote({ path: 'a.md', text: '```a`b\n- [ ] Real 🆔 a' });
  expect(p.tasks.map((t) => t.id)).toEqual(['a']);
 });
 it.each(['\\`⛔ gone `', '\\<!-- ⛔ gone'])('keeps escaped markup literal in %s', (body) => {
  const r = audit([{ path: 'a.md', text: '- [ ] Literal ' + body }]);
  expect(r.issues[0]?.kind).toBe('missing');
 });
 it('ends a list fence when the next task leaves that list item', () => {
  const p = parseNote({ path: 'a.md', text: '- ```md\n  - [ ] Hidden 🆔 a\n- [ ] Real 🆔 a' });
  expect(p.tasks.map((t) => [t.id, t.line])).toEqual([['a', 3]]);
 });
 it('groups repeated ambiguous references without copying each target list', () => {
  const count = 25000;
  const text = [...Array.from({ length: count }, () => '- [ ] Target 🆔 a'), ...Array.from({ length: count }, () => '- [ ] Source ⛔ a')].join('\n');
  const groups = audit([{ path: 'a.md', text }]).issues.filter((i) => i.kind === 'ambiguous');
  expect(groups).toHaveLength(1);
  expect(groups[0]?.sources).toHaveLength(count * 2);
 });
 it.each(['modify', 'delete', 'create'] as const)('marks a scan incomplete after a late %s', async (change) => {
  const p = make({ 'a.md': '- [ ] A 🆔 a', 'b.md': '- [ ] B ⛔ a' });
  const read = p.app.vault.cachedRead.bind(p.app.vault);
  vi.spyOn(p.app.vault, 'cachedRead').mockImplementation(async (file) => {
   const text = await read(file);
   if (file.path === 'b.md') {
    const a = p.app.vault.getFileByPath('a.md')!;
    if (change === 'modify') a.stat.mtime++;
    else if (change === 'delete') await p.app.vault.delete(a);
    else await p.app.vault.create('c.md', '- [ ] C 🆔 a');
   }
   return text;
  });
  expect((await p.scan()).complete).toBe(false);
 });
 it('does not start a refresh interval after unload before layout is ready', async () => {
  const p = make(); let ready = () => undefined;
  vi.spyOn(p.app.workspace, 'onLayoutReady').mockImplementation((cb) => { ready = cb; });
  vi.spyOn(p, 'addSettingTab').mockImplementation(() => undefined);
  await p.onload();
  p.onunload();
  const interval = vi.spyOn(window, 'setInterval').mockReturnValue(1);
  ready();
  expect(interval).not.toHaveBeenCalled();
 });
 it('closes an open saved snapshot on unload', () => {
  pro(); const p = make(); p.settings = { profiles: [], reports: [{ name: 'Snapshot', text: 'Sample result' }] };
  vi.spyOn(p, 'scan').mockResolvedValue(audit([]));
  const opened: Modal[] = [];
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function () { opened.push(this); });
  const m = new AuditModal(p, ''); p.modal = m; m.onOpen();
  const button = [...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Read report')!;
  button.click();
  expect(opened).toHaveLength(1);
  const close = vi.spyOn(opened[0]!, 'close');
  p.onunload();
  expect(close).toHaveBeenCalledOnce();
 });
 it('preserves a long saved folder path after reload', async () => {
  pro(); const p = make(); const folder = Array(80).fill('Long folder name').join('/');
  await p.saveProfile('Long path', folder);
  expect(normalizeSettings(p.settings).profiles[0]?.folder).toBe(folder);
 });
 it('gives the registered command name in the settings instructions', () => {
  const p = make(); const tab = new TaskIdAuditSettingTab(p.app, p);
  expect(tab.getSettingDefinitions()[0]).toMatchObject({ desc: expect.stringContaining('Task ID Audit: Open audit') });
 });
});

describe('claim checks', () => {
 it('applies file and total character limits with unresolved targets', () => {
  const notes = [{ path: 'a.md', text: '- [ ] A ⛔ b' }, { path: 'b.md', text: '- [ ] B 🆔 b' }];
  for (const limits of [{ ...LIMITS, files: 1 }, { ...LIMITS, chars: notes[0]!.text.length }]) {
   const r = audit(notes, 'a', [], limits);
   expect(r.complete).toBe(false);
   expect(r.tasks).toBe(1);
   expect(r.skipped[0]?.path).toBe('b.md');
   expect(audit(notes, '', [], limits).issues[0]?.kind).toBe('unresolved');
  }
 });
 it('does not read a file above the byte limit', async () => {
  const p = make(); p.app.vault.getMarkdownFiles()[0]!.stat.size = LIMITS.fileChars + 1;
  const read = vi.spyOn(p.app.vault, 'cachedRead');
  const r = await p.scan();
  expect(r.complete).toBe(false); expect(r.tasks).toBe(0); expect(read).not.toHaveBeenCalled();
 });
 it('reports a read error without rejecting the scan', async () => {
  const p = make(); vi.spyOn(p.app.vault, 'cachedRead').mockRejectedValue(new Error('Read failure'));
  const r = await p.scan(); expect(r.complete).toBe(false); expect(r.skipped[0]?.reason).toContain('could not be read');
 });
 it('replaces a profile at the limit and refuses a new twenty-first profile', async () => {
  pro(); const p = make();
  for (let n = 0; n < 20; n++) expect(await p.saveProfile(String(n), 'Projects')).toBe(true);
  expect(await p.saveProfile('0', 'Archive')).toBe(true);
  expect(p.settings.profiles).toHaveLength(20);
  expect(p.settings.profiles.find((s) => s.name === '0')?.folder).toBe('Archive');
  expect(await p.saveProfile('New', 'Projects')).toBe(false);
  expect(p.settings.profiles).toHaveLength(20);
 });
 it('refuses an oversized saved report without replacing saved data', async () => {
  pro(); const p = make(); const before = structuredClone(p.settings);
  const save = vi.spyOn(p, 'saveData');
  expect(await p.saveReport('Large', { ...audit([]), folder: 'a'.repeat(100001) })).toBe(false);
  expect(p.settings).toEqual(before); expect(save).not.toHaveBeenCalled();
 });
 it('does not show an ambiguous group unless a dependency refers to the duplicate ID', () => {
  const r = audit([{ path: 'a.md', text: '- [ ] A 🆔 a\n- [ ] B 🆔 a' }]);
  expect(r.issues.map((i) => i.kind)).toEqual(['duplicate']);
 });
});
