import { MarkdownView, Modal, Notice, Plugin, Setting, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { audit, folderPath, LIMITS, type Issue, type Note, type Report, type Skipped, type Source } from './audit';
import { SPONSORS, bindPro, isPro, onProChange, proNotice, resetPro } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, TaskIdAuditSettingTab, type TaskIdAuditSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const LABELS: Record<Issue['kind'], string> = { duplicate: 'Duplicate ID', missing: 'Missing target', ambiguous: 'Ambiguous target', self: 'Self reference', cycle: 'Dependency cycle', unresolved: 'Unresolved target (incomplete index)' };
/** A control name with the Pro mark, the same as in the README and What's new. */
function proLabel(text: string): string { return `${text} (Pro)`; }
export function reportText(report: Report): string {
 const lines = [report.complete ? 'Complete audit' : 'Incomplete audit', `Folder: ${report.folder || '(vault)'}`, `${report.files} files indexed; ${report.tasks} tasks; ${report.issues.length} groups`, ''];
 for (const issue of report.issues) lines.push(`${LABELS[issue.kind]}: ${issue.ids.join(', ')}`, ...issue.sources.map((s) => `  ${s.path}:${s.line}`));
 for (const s of report.skipped) lines.push(`Skipped ${s.path}:${s.line}: ${s.reason}`);
 return lines.join('\n');
}
export default class TaskIdAuditPlugin extends Plugin {
 settings: TaskIdAuditSettings = { ...DEFAULT_SETTINGS };
 pro: SponsorsManager | null = null;
 modal: AuditModal | null = null;
 private timer: number | undefined;
 private unloaded = false;
 private snapshots = new Set<Modal>();
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  this.unloaded = false;
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this); pro.init(); this.pro = pro; bindPro(pro);
  const tab = new TaskIdAuditSettingTab(this.app, this); this.addSettingTab(tab);
  this.register(onProChange(() => { tab.update(); this.modal?.updatePro(); }));
  this.addCommand({ id: 'open-audit', name: 'Open audit', callback: () => { this.openAudit(); } });
  this.registerEvent(this.app.vault.on('modify', (f) => this.changed(f)));
  this.registerEvent(this.app.vault.on('create', (f) => this.changed(f)));
  this.registerEvent(this.app.vault.on('delete', (f) => this.changed(f)));
  this.registerEvent(this.app.vault.on('rename', (f, oldPath) => { if (oldPath.endsWith('.md')) this.schedule(); else this.changed(f); }));
  this.register(() => window.clearTimeout(this.timer));
  this.app.workspace.onLayoutReady(() => {
   if (this.unloaded) return;
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 private changed(file: { path: string }): void { if (file.path.endsWith('.md') || !(file instanceof TFile)) this.schedule(); }
 private schedule(): void {
  if (!isPro() || !this.modal?.live) return;
  window.clearTimeout(this.timer);
  this.timer = window.setTimeout(() => { if (isPro() && this.modal?.live) void this.modal.refresh(); }, 500);
 }
 onunload(): void { this.unloaded = true; this.modal?.close(); for (const modal of this.snapshots) modal.close(); this.snapshots.clear(); resetPro(); }
 openSnapshot(name: string, text: string): void {
  if (!isPro()) return;
  const modal = new Modal(this.app); modal.setTitle(name);
  modal.contentEl.createEl('pre', { text, cls: 'task-id-audit-snapshot' });
  modal.onClose = () => { modal.contentEl.empty(); this.snapshots.delete(modal); };
  this.snapshots.add(modal); modal.open();
 }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 openAudit(folder = ''): AuditModal {
  this.modal?.close(); const modal = new AuditModal(this, folder); this.modal = modal; modal.open(); return modal;
 }
 async scan(folder = ''): Promise<Report> {
  const notes: Note[] = [], omitted: Skipped[] = [];
  const files = this.app.vault.getMarkdownFiles().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const initial = new Map(files.map((file) => [file.path, { file, mtime: file.stat.mtime, size: file.stat.size }]));
  let chars = 0;
  for (let n = 0; n < files.length; n++) {
   const file = files[n]!, path = file.path, mtime = file.stat.mtime, size = file.stat.size;
   if (n >= LIMITS.files || size > LIMITS.fileChars || chars >= LIMITS.chars) { omitted.push({ path, line: 1, reason: 'Scan size limit' }); continue; }
   try {
    const text = await this.app.vault.cachedRead(file); chars += text.length;
    if (file.path !== path || file.stat.mtime !== mtime || file.stat.size !== size) omitted.push({ path, line: 1, reason: 'File changed during scan; run again' });
    notes.push({ path, text });
   } catch { omitted.push({ path, line: 1, reason: 'File could not be read; run again' }); }
  }
  const current = new Map(this.app.vault.getMarkdownFiles().map((file) => [file.path, file]));
  for (const [path, before] of initial) {
   const file = current.get(path);
   if ((file !== before.file || file.stat.mtime !== before.mtime || file.stat.size !== before.size) && !omitted.some((s) => s.path === path)) omitted.push({ path, line: 1, reason: 'File changed during scan; run again' });
  }
  for (const path of current.keys()) if (!initial.has(path)) omitted.push({ path, line: 1, reason: 'File added during scan; run again' });
  return audit(notes, folder, omitted);
 }
 async openSource(source: Source): Promise<void> {
  const file = this.app.vault.getFileByPath(source.path);
  if (!file) { new Notice('The source file is no longer present. Run the audit again.'); return; }
  const leaf = this.app.workspace.getLeaf(false);
  await leaf.openFile(file, { state: { mode: 'source' } });
  if (leaf.view instanceof MarkdownView) {
   const pos = { line: Math.max(0, source.line - 1), ch: 0 };
   leaf.view.editor.setCursor(pos); leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
  }
 }
 async saveProfile(name: string, folder: string): Promise<boolean> {
  if (!isPro()) return false;
  name = name.trim().slice(0, 80); if (!name) return false;
  const profiles = this.settings.profiles.filter((p) => p.name !== name);
  if (profiles.length >= 20) { new Notice('The profile limit is 20. Replace a named profile.'); return false; }
  this.settings.profiles = [...profiles, { name, folder: folderPath(folder) }]; await this.saveSettings(); return true;
 }
 async saveReport(name: string, report: Report): Promise<boolean> {
  if (!isPro()) return false;
  const text = reportText(report);
  if (text.length > 100000) { new Notice('This report is too large to save. Use a folder filter.'); return false; }
  this.settings.reports = [{ name: name.trim().slice(0, 80) || 'Audit report', text }, ...this.settings.reports].slice(0, 5);
  await this.saveSettings(); return true;
 }
}

export class AuditModal extends Modal {
 report: Report | null = null;
 live = false;
 folder: string;
 private generation = 0;
 private results: HTMLElement | null = null;
 private proControls: HTMLElement | null = null;
 private name = '';
 constructor(readonly plugin: TaskIdAuditPlugin, folder: string) { super(plugin.app); this.folder = folderPath(folder); }
 onOpen(): void {
  this.setTitle('Task ID audit'); this.modalEl.addClass('task-id-audit-modal');
  const el = this.contentEl; el.empty();
  el.createEl('p', { text: 'Read-only checks for task identifiers and dependency links. Targets are indexed across the vault.', cls: 'task-id-audit-intro' });
  new Setting(el).setName('Report folder').setDesc('Empty means the vault. Other folders still supply dependency targets.')
   .addText((t) => t.setValue(this.folder).onChange((value) => { this.folder = value; }))
   .addButton((b) => b.setButtonText('Run audit').setCta().onClick(() => this.refresh()));
  this.proControls = el.createDiv({ cls: 'task-id-audit-pro' }); this.updatePro();
  this.results = el.createDiv({ cls: 'task-id-audit-results' }); this.results.setAttribute('aria-live', 'polite');
  void this.refresh();
 }
 updatePro(): void {
  const el = this.proControls; if (!el) return; el.empty(); if (!isPro()) this.live = false;
  new Setting(el).setName(proLabel('Repeat after file changes')).setDesc('While this report is open, repeat after a Markdown file changes.')
   .addToggle((t) => t.setValue(this.live).onChange((value) => {
    if (value && !isPro()) {
     // A free user can select the toggle: the shared notice shows what Pro adds and how to get it. Repeat stays off.
     proNotice('Repeat after file changes is a Pro feature.');
     // Obsidian does not draw a focused control again. Move the focus out, then draw the Pro rows again.
     const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
     if (active && this.contentEl.contains(active)) active.blur();
     this.live = false; this.updatePro(); return;
    }
    this.live = isPro() && value;
   }));
  const saved = new Setting(el).setName(proLabel('Project profiles and reports'));
  if (!isPro()) { saved.setDesc('Pro adds named folder profiles and the last five saved reports. Free checks have the same audit rules.'); return; }
  saved.addText((t) => t.setValue(this.name).onChange((v) => { this.name = v; }))
   .addButton((b) => b.setButtonText('Save profile').onClick(async () => { if (await this.plugin.saveProfile(this.name, normalizePath(this.folder.trim()))) this.updatePro(); }))
   .addButton((b) => b.setButtonText('Save report').onClick(async () => { if (this.report && await this.plugin.saveReport(this.name, this.report)) this.updatePro(); }));
  for (const profile of this.plugin.settings.profiles) new Setting(el).setName(profile.name).setDesc(profile.folder || 'Vault')
   .addButton((b) => b.setButtonText('Load profile').onClick(() => { if (isPro()) { this.close(); this.plugin.openAudit(profile.folder); } }));
  for (const report of this.plugin.settings.reports) new Setting(el).setName(report.name).setDesc('Saved snapshot')
   .addButton((b) => b.setButtonText('Read report').onClick(() => { if (isPro()) this.plugin.openSnapshot(report.name, report.text); }));
 }
 async refresh(): Promise<void> {
  const generation = ++this.generation;
  this.folder = this.folder.trim() ? normalizePath(this.folder.trim()) : '';
  this.results?.setText('Indexing Markdown notes…');
  try {
   const report = await this.plugin.scan(this.folder);
   if (generation !== this.generation || this.plugin.modal !== this) return;
   this.report = report; this.render();
  } catch { if (generation === this.generation) this.results?.setText('The audit failed. Run it again.'); }
 }
 render(): void {
  const el = this.results, report = this.report; if (!el || !report) return; el.empty();
  const status = !report.complete ? 'Incomplete audit' : report.issues.length ? 'Findings to review' : 'No findings in supported tasks';
  el.createDiv({ text: status, cls: 'task-id-audit-status' });
  el.createEl('p', { text: `${report.files} files indexed · ${report.tasks} tasks · ${report.issues.length} groups · Folder: ${report.folder || 'Vault'}` });
  if (!report.complete) el.createEl('p', { text: 'Some input was skipped. Unresolved targets can exist in that input. This report is not a clean result.', cls: 'task-id-audit-warning' });
  for (const issue of report.issues) {
   const card = el.createDiv({ cls: 'task-id-audit-card' }); card.dataset.kind = issue.kind;
   card.createEl('strong', { text: `${LABELS[issue.kind]} · ${issue.ids.join(', ')}` });
   for (const source of issue.sources) {
    const b = card.createEl('button', { text: `${source.path}:${source.line}`, cls: 'task-id-audit-source' });
    b.addEventListener('click', () => { this.close(); void this.plugin.openSource(source); });
   }
  }
  if (report.skipped.length) {
   new Setting(el).setName(`Skipped input (${report.skipped.length})`).setHeading();
   for (const skip of report.skipped) el.createEl('p', { text: `${skip.path}:${skip.line} — ${skip.reason}` });
  }
 }
 onClose(): void { this.generation++; this.live = false; this.contentEl.empty(); if (this.plugin.modal === this) this.plugin.modal = null; }
}
