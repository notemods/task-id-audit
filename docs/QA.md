# Task ID Audit QA notes

## Test scope

The unit suite includes 32 golden vectors. It checks duplicate locations, missing targets, self references, ambiguous targets, completed targets, folder boundaries, source line numbers, code exclusions, unsupported fields, and stable read-only reports. A separate test uses 30,000 nodes in one cycle. Limit tests check incomplete reports. Plugin tests use the Obsidian test mocks.

The real app suite uses wdio-obsidian-service on the earliest supported public release, 1.13.4, and the latest release, 1.14.4. It checks source navigation, plugin reload, saved Pro data, and a repeat audit after a target changes outside the report folder. It waits for observable state. It makes no color or theme assertion.

The Pro fixture substitutes the GitHub HTTP response before it sets a fake device token. It uses the same SponsorsManager and facade as the plugin. It does not send a payment or use a live GitHub account.

## Media review

Use qa.json with ./fx dev task-id-audit. The sample notes have 11 ordinary tasks in six Markdown files. The screenshots show duplicate and ambiguous targets, missing and self targets, a cycle, a resolved folder report, an opened source note, saved profiles, and repeat mode. The GIF shows the duplicate report, the cycle report, and the source note. Inspect the GIF frames as well as the PNG files.

The dev command must show No errors captured and reloaded with 0 errors. Hold the shared app lock for app commands. Use the lane profile and vault from the builder brief. Release the lock when the app checks finish.

## Limits of this check

A physical phone or tablet, third-party sync conflicts, unusual Markdown extensions, and a live paid sponsorship transaction were not tested. Linux and Windows were not run locally. The end-to-end tests avoid fixed sleeps, color assertions, and theme selectors. CI can run the same tests on Linux.

## Export check

Run the exported release workflow checks outside the factory with tools/export-tree-test.sh task-id-audit. The exported vectors use local JSON files. The unit tests do not read product.yaml or factory tool files. Check main.js for a script element constructor. The expected match count is zero.
