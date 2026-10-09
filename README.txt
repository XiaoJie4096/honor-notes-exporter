Honor Notes Exporter

See README.md for full documentation.

Install:
1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select the extracted folder containing manifest.json
5. Open https://cloud.honor.com/portal/notepad and sign in
6. Click the extension icon and start with Export 10 for validation

The extension exports text and image notes as a local ZIP containing Markdown,
downloaded image assets, and export-report.json. Handwritten and locked notes
are skipped and listed in the report.

Privacy: the extension reads only the currently signed-in Honor Notes account,
does not collect credentials, and does not upload note content anywhere.
