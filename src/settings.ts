import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type TaskIdAuditPlugin from './main';
export interface Profile { name: string; folder: string }
export interface SavedReport { name: string; text: string }
export interface TaskIdAuditSettings { profiles: Profile[]; reports: SavedReport[] }
export const DEFAULT_SETTINGS: TaskIdAuditSettings = { profiles: [], reports: [] };
export function normalizeSettings(value: unknown): TaskIdAuditSettings {
 const s = value && typeof value === 'object' ? value as Partial<TaskIdAuditSettings> : {};
 return {
  profiles: Array.isArray(s.profiles) ? s.profiles.filter((p) => p && typeof p.name === 'string' && typeof p.folder === 'string').slice(0, 20).map((p) => ({ name: p.name.slice(0, 80), folder: p.folder })) : [],
  reports: Array.isArray(s.reports) ? s.reports.filter((p) => p && typeof p.name === 'string' && typeof p.text === 'string').slice(0, 5).map((p) => ({ name: p.name.slice(0, 80), text: p.text.slice(0, 100000) })) : [],
 };
}
export class TaskIdAuditSettingTab extends PluginSettingTab {
 plugin: TaskIdAuditPlugin;
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: TaskIdAuditPlugin) { super(app, plugin); this.plugin = plugin; }
 getSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Read-only audit', desc: 'Run Task ID Audit: Open audit from the command palette. The folder filter changes the report. Targets come from the vault.' },
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
  ];
 }
}
