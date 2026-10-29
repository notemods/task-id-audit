import { $, browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type TaskIdAuditPlugin from '../../src/main';

// Keyboard focus after a refused Pro toggle in the audit modal (s1028 TIA, R-LIST minor). A free user presses Space on
// "Repeat after file changes (Pro)". The modal refuses the change, shows the Pro notice and draws the Pro rows again.
// The keyboard focus must stay on the toggle of the same row, and repeated refused keys must show only 1 notice.
// Obsidian can show a view in a second window, so the test sends the keys to the window that shows the toggle row.
const ROW = 'Repeat after file changes (Pro)';
const LEAD = 'Repeat after file changes is a Pro feature.';
const SPACE = '';

type Plugins = { plugins: { plugins: Record<string, TaskIdAuditPlugin> } };

interface Where {
	hasFocus: boolean;
	tag: string;
	row: string | null;
	enabled: boolean | null;
	notices: number;
}

/** Runs in the window that shows the modal: where the keyboard focus is, the toggle state and the Pro notices. */
const where = (): Promise<Where> =>
	browser.execute(
		(name: string, lead: string) => {
			const a = document.activeElement as HTMLElement | null;
			const row = [...document.querySelectorAll('.task-id-audit-modal .setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
			const box = row?.querySelector('.checkbox-container');
			const docs = new Set([document, (window as unknown as { activeDocument?: Document }).activeDocument ?? document]);
			return {
				hasFocus: document.hasFocus(),
				tag: a ? a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(' ')[0] : '') : '',
				row: a?.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent ?? null,
				enabled: box ? box.classList.contains('is-enabled') : null,
				notices: [...docs].reduce((n, d) => n + [...d.querySelectorAll('.notice')].filter((e) => (e.textContent ?? '').includes(lead)).length, 0),
			};
		},
		ROW,
		LEAD,
	);

const live = (): Promise<boolean | null> =>
	browser.executeObsidian(({ app }, id) => (app as unknown as Plugins).plugins.plugins[id]!.modal?.live ?? null, pluginId);

describe(`${pluginId} keyboard focus after a refused Pro toggle`, function () {
	let main = '';
	after(async function () {
		if (main) await browser.switchToWindow(main);
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as Plugins).plugins.plugins[id]!.modal?.close();
			for (const d of new Set([document, activeDocument])) d.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
	});

	it(`a free user who presses Space on "${ROW}" keeps the keyboard focus on that toggle and gets 1 notice for 3 keys (desktop only: phone and tablet have no keyboard focus ring)`, async function () {
		if (await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile)) this.skip();
		main = await browser.getWindowHandle();
		// A free user: sign out, remove old notices, then open the audit from the command.
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as Plugins).plugins.plugins[id]!.pro!.signOut();
			for (const d of new Set([document, activeDocument])) d.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		await browser.executeObsidianCommand(`${pluginId}:open-audit`);
		await browser.waitUntil(
			async () => browser.executeObsidian((_o, name) => [...activeDocument.querySelectorAll('.task-id-audit-modal .setting-item-name')].some((e) => e.textContent === name), ROW),
			{ timeout: 15000, timeoutMsg: `The audit modal has no row "${ROW}".` },
		);
		await browser.pause(500);
		// Send the keys to the window that shows the row.
		const handles = await browser.getWindowHandles();
		let found = '';
		for (const handle of handles) {
			await browser.switchToWindow(handle);
			const has = await browser.execute((name: string) => [...document.querySelectorAll('.task-id-audit-modal .setting-item-name')].some((e) => e.textContent === name), ROW);
			if (has) {
				found = handle;
				break;
			}
		}
		console.log(`focus-keep: ${handles.length} window handles, row in ${found === main ? 'the first' : found ? 'another' : 'no'} window`);
		expect(found).not.toBe('');
		// Put the keyboard focus on the toggle of the row. Then check that this window has the focus, so a real key goes there.
		await browser.execute((name: string) => {
			const row = [...document.querySelectorAll('.task-id-audit-modal .setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)!;
			const box = row.querySelector<HTMLElement>('.checkbox-container')!;
			box.focus();
			document.querySelectorAll('[data-focus-test]').forEach((e) => e.removeAttribute('data-focus-test'));
			box.setAttribute('data-focus-test', '1');
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, ROW);
		const before = await where();
		console.log(`focus-keep: before ${JSON.stringify(before)}`);
		expect({ hasFocus: before.hasFocus, row: before.row, enabled: before.enabled, notices: before.notices }).toEqual({ hasFocus: true, row: ROW, enabled: false, notices: 0 });
		// A real key (Space) turns the toggle on. The modal refuses the change and shows the Pro notice.
		await $('[data-focus-test="1"]').addValue(SPACE);
		await browser.waitUntil(async () => (await where()).notices > 0, { timeout: 5000 }).catch(() => undefined);
		await browser.pause(500);
		const after = await where();
		console.log(`focus-keep: after 1 key ${JSON.stringify(after)} live ${String(await live())}`);
		expect({ notices: after.notices, enabled: after.enabled, live: await live() }).toEqual({ notices: 1, enabled: false, live: false });
		// The modal drew the Pro rows again. The keyboard focus is still on the toggle of the same row.
		expect({ tag: after.tag, row: after.row }).toEqual({ tag: before.tag, row: ROW });
		// The same key 2 more times on the focused toggle: each change is refused again, but only 1 Pro notice shows.
		for (let i = 0; i < 2; i++) {
			await browser.execute(() => {
				document.querySelectorAll('[data-focus-test]').forEach((e) => e.removeAttribute('data-focus-test'));
				(document.activeElement as HTMLElement | null)?.setAttribute('data-focus-test', '1');
			});
			await $('[data-focus-test="1"]').addValue(SPACE);
			await browser.pause(500);
		}
		const third = await where();
		console.log(`focus-keep: after 3 keys ${JSON.stringify(third)}`);
		expect({ notices: third.notices, enabled: third.enabled, live: await live(), tag: third.tag, row: third.row }).toEqual({ notices: 1, enabled: false, live: false, tag: before.tag, row: ROW });
	});
});
