// Validates the packaged extension the way Chrome itself does: --pack-extension parses
// manifest.json with Chrome's real parser and refuses to produce a CRX if it is invalid.
// Static checks cover files Chrome would only report at runtime.
import { mkdtempSync, rmSync, existsSync, readFileSync,  readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "release/honor-notes-exporter");
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const failures = [];
const notes = [];
const ok = (m) => notes.push(m);

if (!existsSync(join(extDir, "manifest.json"))) {
  console.error(`FAIL 鈥?${extDir} has no manifest.json; run package-release.ps1 first`);
  process.exit(1);
}

// --- static manifest checks ---
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) failures.push("manifest_version is not 3");
for (const key of ["name", "version", "description"]) {
  if (!manifest[key]) failures.push(`manifest.json missing "${key}"`);
}
for (const size of ["16", "32", "48", "128"]) {
  const rel = manifest.icons?.[size];
  if (!rel) failures.push(`manifest.json missing icon ${size}`);
  else if (!existsSync(join(extDir, rel))) failures.push(`icon file missing: ${rel}`);
  const actionIcon = manifest.action?.default_icon?.[size];
  if (actionIcon && !existsSync(join(extDir, actionIcon))) failures.push(`action icon missing: ${actionIcon}`);
}
if (!manifest.action?.default_popup) failures.push("no default_popup in action");
else if (!existsSync(join(extDir, manifest.action.default_popup))) failures.push("popup.html missing");
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) {
    if (!existsSync(join(extDir, js))) failures.push(`content script missing: ${js}`);
  }
}
if (!existsSync(join(extDir, manifest.background?.service_worker || ""))) {
  failures.push("background service worker file missing");
}
// The bundler output must not still import fflate at runtime (content scripts cannot resolve bare specifiers).
const bundle = readFileSync(join(extDir, "dist/content.js"), "utf8");
if (/^\s*import\s.+from\s+["']fflate["']/m.test(bundle)) {
  failures.push("dist/content.js still imports fflate at runtime; bundle it instead");
}
ok(`manifest v${manifest.version}, ${manifest.permissions.length} permissions, all referenced files present`);

// --- every script must be syntactically valid ---
for (const rel of ["background.js", "dist/content.js", "popup.js"]) {
  const check = spawnSync(process.execPath, ["--check", join(extDir, rel)], { encoding: "utf8" });
  if (check.status === 0) ok(`${rel} parses`);
  else failures.push(`${rel}: ${(check.stderr || "").split("\n")[0]}`);
}

// --- Chrome's own manifest validation via pack-extension ---
const work = mkdtempSync(join(tmpdir(), "hne-pack-"));

const stage = join(work, "ext");
execFileSync("powershell", ["-NoProfile", "-Command",
  `Copy-Item -Recurse -LiteralPath '${extDir.replace(/'/g, "''")}' -Destination '${stage.replace(/'/g, "''")}'`],
  { stdio: "ignore" });

try {
  spawnSync(chrome, [`--pack-extension=${stage}`, "--no-message-box"], { timeout: 60000 });
} catch {}
const crx = readdirSync(work).find((f) => f.endsWith(".crx"));
if (crx) {
  const bytes = readFileSync(join(work, crx));
  const magic = bytes.subarray(0, 4).toString("ascii");
  const versionNumber = bytes.readUInt32LE(4);
  if (magic === "Cr24" && versionNumber === 3) ok(`Chrome packed the extension into a valid CRX3 (${bytes.length} bytes)`);
  else failures.push(`unexpected CRX header: ${magic} v${versionNumber}`);
} else {
  failures.push("Chrome refused to pack the extension 鈥?manifest is invalid");
}
try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}

for (const n of notes) console.log("ok   " + n);
if (failures.length) {
  console.error("\nFAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nextension package is valid and Chrome-loadable");
