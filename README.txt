Honor Notes Exporter

See README.md for full documentation.

What it does:
Exports your Honor cloud notes (cloud.honor.com) as Markdown (.md) files plus
original images, packed into a local ZIP. One .md per note, images stored as
separate files under assets/.

Install:
1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select the extracted folder containing manifest.json
5. Open https://cloud.honor.com/portal/notepad and sign in
6. Click the extension icon and start with Export 10 for validation

Handwritten and locked notes are skipped and listed in export-report.json.

About this project:
This was a rough little tool made with AI because a friend needed it. It turned
out a more complete alternative already exists (note-bridge-desktop); if you
want more export formats or cross-platform migration, use that instead. This one
is only worth it if you want a no-install browser extension that exports
Markdown. If something is broken or missing, open an issue and I will fix it, or
just fork it and edit it with AI yourself.

Privacy: the extension reads only the currently signed-in Honor Notes account,
does not collect credentials, and does not upload note content anywhere.
