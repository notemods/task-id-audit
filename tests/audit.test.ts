import { describe, expect, it } from 'vitest';
import vectors from './vectors/task-id-audit.json';
import { audit, cycleGroups, LIMITS, type Note, type Skipped } from '../src/audit';
describe('golden acceptance vectors', () => {
 it('has at least twenty cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 for (const c of vectors.cases) it(c.name, () => {
  const [notes, folder] = c.args as [Note[], string]; const before = JSON.stringify(notes);
  expect(audit(notes, folder)).toEqual(c.expected); expect(JSON.stringify(notes)).toBe(before); expect(audit(notes, folder)).toEqual(audit(notes, folder));
 });
});
describe('safe bounds and graph search', () => {
 it('handles a long cycle without recursion', () => { const g = new Map(Array.from({ length: 30000 }, (_, n) => [String(n), [String((n + 1) % 30000)]])); expect(cycleGroups(g)[0]).toHaveLength(30000); });
 it('does not call a size limited audit clean', () => { const r = audit([{ path: 'a.md', text: '- [ ] A 🆔 a' }], '', [], { ...LIMITS, fileChars: 1 }); expect(r.complete).toBe(false); expect(r.tasks).toBe(0); });
 it('reports task truncation and unresolved dependencies', () => { const r = audit([{ path: 'a.md', text: '- [ ] A ⛔ b\n- [ ] B 🆔 b' }], '', [], { ...LIMITS, tasks: 1 }); expect(r.complete).toBe(false); expect(r.issues[0]!.kind).toBe('unresolved'); });
 it('reports an unreadable file as incomplete', () => { const skip: Skipped = { path: 'bad.md', line: 1, reason: 'Read failed' }; expect(audit([], '', [skip]).complete).toBe(false); });
});
