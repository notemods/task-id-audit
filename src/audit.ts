export interface Note { path: string; text: string }
export interface Source { path: string; line: number }
export interface Task extends Source { id: string | null; depends: string[]; text: string }
export interface Issue { kind: 'duplicate' | 'missing' | 'ambiguous' | 'self' | 'cycle' | 'unresolved'; ids: string[]; sources: Source[] }
export interface Skipped extends Source { reason: string }
export interface Report { folder: string; files: number; tasks: number; complete: boolean; issues: Issue[]; skipped: Skipped[] }
export const LIMITS = { files: 10000, chars: 20000000, fileChars: 2000000, tasks: 50000 };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function folderPath(value: string): string { return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export function inFolder(path: string, folder: string): boolean { return !folder || path.startsWith(folder + '/'); }
const hasField = (s: string): boolean => /🆔|⛔|\[(?:id|dependsOn)::/i.test(s);
function escaped(line: string, start: number): boolean {
 let slashes = 0;
 for (let n = start - 1; n >= 0 && line[n] === '\\'; n--) slashes++;
 return slashes % 2 === 1;
}

/** Mask comments and code together. Comment markers inside code are literal text. */
function visibleText(line: string, state: { comment: boolean; code: string }, closesLater: (run: string) => boolean): string {
 const tokens = [...line.matchAll(/`+|<!--|-->/g)];
 const nextRun = new Map<string, number>(), closing = new Map<number, number>();
 for (let n = tokens.length - 1; n >= 0; n--) {
  const token = tokens[n]![0]; if (!token.startsWith('`')) continue;
  const next = nextRun.get(token); if (next !== undefined) closing.set(n, next);
  nextRun.set(token, n);
 }
 let result = '', cursor = 0;
 for (let n = 0; n < tokens.length; n++) {
  const token = tokens[n]!, start = token.index;
  if (state.code) {
   if (token[0] === state.code) { state.code = ''; cursor = start + token[0].length; }
  } else if (state.comment) {
   if (token[0] === '-->') { state.comment = false; cursor = start + 3; }
  } else if (escaped(line, start)) {
   continue;
  } else if (token[0] === '<!--') {
   result += line.slice(cursor, start) + ' '; cursor = start + 4; state.comment = true;
  } else if (token[0].startsWith('`')) {
   const end = closing.get(n);
   if (end === undefined) {
    if (closesLater(token[0])) { result += line.slice(cursor, start) + ' '; state.code = token[0]; break; }
    continue;
   }
   result += line.slice(cursor, start) + ' '; cursor = tokens[end]!.index + tokens[end]![0].length; n = end;
  }
 }
 return result + (state.comment || state.code ? '' : line.slice(cursor));
}
const fenceStart = (line: string): RegExpMatchArray | null => {
 const match = line.match(/^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/);
 return match && !(match[1]![0] === '`' && match[2]!.includes('`')) ? match : null;
};
const quoteDepth = (line: string): number => (line.match(/^\s*(?:>\s*)*/)?.[0].match(/>/g) ?? []).length;
const listFenceIndent = (line: string): number => (line.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/)?.[0] ?? '').replace(/\t/g, '    ').length;
const indent = (line: string): number => (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;

/** Read ordinary checkbox task lines. Preserve the physical source line. */
export function parseNote(note: Note): { tasks: Task[]; skipped: Skipped[] } {
 const tasks: Task[] = [], skipped: Skipped[] = [];
 let front = false, fence = '', fenceLength = 0, fenceQuoteDepth = 0, fenceIndent = 0;
 const state = { comment: false, code: '' };
 const lines = note.text.replace(/^\uFEFF/, '').split(/\r?\n/);
 for (let i = 0; i < lines.length; i++) {
  let s = lines[i]!;
  if (i === 0 && s.trim() === '---') { front = true; continue; }
  if (front) { if (/^(---|\.\.\.)\s*$/.test(s)) front = false; continue; }
  if (fence && quoteDepth(s) < fenceQuoteDepth) fence = '';
  if (fence && fenceIndent && s.trim() && indent(s) < fenceIndent) fence = '';
  if (fence) {
   const close = s.match(/^\s*(?:>\s*)*(`{3,}|~{3,})\s*$/);
   if (close && close[1]![0] === fence && close[1]!.length >= fenceLength) fence = '';
   continue;
  }
  const rawOpen = !state.comment && !state.code ? fenceStart(s) : null;
  if (rawOpen) { fence = rawOpen[1]![0]!; fenceLength = rawOpen[1]!.length; fenceQuoteDepth = quoteDepth(s); fenceIndent = listFenceIndent(s); continue; }
  s = visibleText(s, state, (run) => {
   for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j]!;
    if (!next.trim() || /^\s*(?:>|#{1,6}\s|(?:[-+*]|\d+[.)])\s|`{3,}|~{3,})/.test(next)) break;
    if ([...next.matchAll(/`+/g)].some((m) => m[0] === run)) return true;
   }
   return false;
  });
  const open = !state.code ? fenceStart(s) : null;
  if (open) { fence = open[1]![0]!; fenceLength = open[1]!.length; fenceQuoteDepth = quoteDepth(s); fenceIndent = listFenceIndent(s); continue; }
  const source = { path: note.path, line: i + 1 };
  const task = s.match(/^\s*(?:[-+*]|\d+[.)])\s+\[[^\]\r\n]\]\s+(.*)$/);
  if (!task) { if (hasField(s)) skipped.push({ ...source, reason: 'Unsupported task form or field outside a task' }); continue; }
  const body = task[1]!;
  if (/\[(?:id|dependsOn)::/i.test(body)) { skipped.push({ ...source, reason: 'Dataview fields are unsupported' }); continue; }
  const fields = [...body.matchAll(/(🆔|⛔)\s*([^🆔⛔]*)/gu)];
  let id: string | null = null, depends: string[] = [], bad = '';
  const seen = new Set<string>();
  for (const field of fields) {
   const symbol = field[1]!, rest = field[2]!;
   if (seen.has(symbol)) { bad = 'Repeated ID or dependency field'; break; }
   seen.add(symbol);
   const value = rest.match(symbol === '🆔' ? /^[A-Za-z0-9_-]+/ : /^[A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*/)?.[0];
   const tail = rest.slice(value?.length ?? 0);
   if (!value || /^[^\s\p{Extended_Pictographic}]/u.test(tail) || /^\s*,/.test(tail)) { bad = 'Invalid ID or dependency field'; break; }
   if (symbol === '🆔') id = value;
   else depends = [...new Set(value.split(',').map((v) => v.trim()))];
  }
  if (bad) skipped.push({ ...source, reason: bad });
  else tasks.push({ ...source, id, depends, text: body });
 }
 return { tasks, skipped };
}

/** Iterative Kosaraju search avoids a call stack limit on long dependency chains. */
export function cycleGroups(graph: Map<string, string[]>): string[][] {
 const seen = new Set<string>(), order: string[] = [];
 for (const root of graph.keys()) {
  if (seen.has(root)) continue;
  const stack: [string, boolean][] = [[root, false]];
  while (stack.length) {
   const [node, done] = stack.pop()!;
   if (done) { order.push(node); continue; }
   if (seen.has(node)) continue;
   seen.add(node); stack.push([node, true]);
   for (const target of graph.get(node) ?? []) if (!seen.has(target)) stack.push([target, false]);
  }
 }
 const reverse = new Map<string, string[]>();
 for (const node of graph.keys()) reverse.set(node, []);
 for (const [node, targets] of graph) for (const target of targets) reverse.get(target)?.push(node);
 seen.clear(); const groups: string[][] = [];
 for (const root of order.reverse()) {
  if (seen.has(root)) continue;
  const group: string[] = [], stack = [root]; seen.add(root);
  while (stack.length) {
   const node = stack.pop()!; group.push(node);
   for (const target of reverse.get(node) ?? []) if (!seen.has(target)) { seen.add(target); stack.push(target); }
  }
  if (group.length > 1) groups.push(group.sort(compare));
 }
 return groups.sort((a, b) => compare(a.join(','), b.join(',')));
}

export function audit(notes: Note[], folder = '', omitted: Skipped[] = [], limits = LIMITS): Report {
 folder = folderPath(folder);
 const tasks: Task[] = [], skipped = [...omitted]; let chars = 0, files = 0;
 for (const note of [...notes].sort((a, b) => compare(a.path, b.path))) {
  if (files >= limits.files || note.text.length > limits.fileChars || chars + note.text.length > limits.chars) { skipped.push({ path: note.path, line: 1, reason: 'Scan size limit' }); continue; }
  files++; chars += note.text.length;
  const parsed = parseNote(note); for (const item of parsed.skipped) skipped.push(item);
  const available = Math.max(0, limits.tasks - tasks.length);
  for (const task of parsed.tasks.slice(0, available)) tasks.push(task);
  if (parsed.tasks.length > available) skipped.push({ path: note.path, line: 1, reason: 'Task count limit' });
 }
 const complete = skipped.length === 0, issues: Issue[] = [];
 const index = new Map<string, Task[]>();
 for (const t of tasks) if (t.id !== null) { const group = index.get(t.id) ?? []; group.push(t); index.set(t.id, group); }
 const source = (t: Source): Source => ({ path: t.path, line: t.line });
 for (const [id, group] of index) if (group.length > 1) issues.push({ kind: 'duplicate', ids: [id], sources: group.map(source) });
 const graph = new Map<string, string[]>();
 const ambiguous = new Map<string, Source[]>();
 for (const [id, group] of index) if (group.length === 1) graph.set(id, []);
 for (const t of tasks) for (const target of t.depends) {
  const matches = index.get(target) ?? [];
  if (target === t.id) issues.push({ kind: 'self', ids: [target], sources: [source(t)] });
  if (!matches.length) issues.push({ kind: complete ? 'missing' : 'unresolved', ids: [target], sources: [source(t)] });
  else if (matches.length > 1) { const references = ambiguous.get(target) ?? []; references.push(source(t)); ambiguous.set(target, references); }
  else if (t.id && graph.has(t.id) && target !== t.id) graph.get(t.id)!.push(target);
 }
 for (const [id, references] of ambiguous) {
  const sources = new Map<string, Source>();
  for (const s of [...references, ...index.get(id)!.map(source)]) sources.set(JSON.stringify([s.path, s.line]), s);
  issues.push({ kind: 'ambiguous', ids: [id], sources: [...sources.values()] });
 }
 for (const ids of cycleGroups(graph)) issues.push({ kind: 'cycle', ids, sources: ids.map((id) => source(index.get(id)![0]!)) });
 const visible = issues.filter((issue) => issue.sources.some((s) => inFolder(s.path, folder)));
 visible.sort((a, b) => compare(a.kind, b.kind) || compare(a.ids.join(','), b.ids.join(',')) || compare(JSON.stringify(a.sources), JSON.stringify(b.sources)));
 return { folder, files, tasks: tasks.length, complete, issues: visible, skipped };
}
