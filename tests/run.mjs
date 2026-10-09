// Runs the real src/convert.js against a real DOM (headless Chrome) and asserts behaviour.
// Usage: node tests/run.mjs
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bundle the pure helpers for the browser, exposing them on window.__t.
await build({
  entryPoints: [join(root, "src/convert.js")],
  bundle: true,
  format: "iife",
  globalName: "__t",
  outfile: join(root, "tests/.convert.bundle.js"),
});

const page = `<!doctype html><meta charset="utf-8"><body><script src="/bundle.js"></script></body>`;

const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(join(root, "tests/.convert.bundle.js")));
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "hne-test-"));
const child = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0",
  `http://127.0.0.1:${port}/`,
], { stdio: ["ignore", "pipe", "pipe"] });

// Wait for the page target to be exposed, then drive it over the DevTools protocol.
const { webSocketDebuggerUrl } = await new Promise((resolve, reject) => {
  const onData = (buf) => {
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(buf));
    if (match) resolve({ webSocketDebuggerUrl: match[1] });
  };
  child.stderr.on("data", onData);
  child.stdout.on("data", onData);
  setTimeout(() => reject(new Error("Chrome did not report a DevTools endpoint")), 20000);
});

const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}

// Attach to the real page target (not the browser target).
const { result: { targetInfos } } = await send("Target.getTargets");
const pageTarget = targetInfos.find((t) => t.type === "page" && t.url.includes(String(port)));
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
function evalInPage(expression) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true }, sessionId }));
  });
}

async function waitForHelpers() {
  for (let i = 0; i < 60; i += 1) {
    const r = await evalInPage("typeof window.__t === 'object' && typeof window.__t.htmlToMarkdown === 'function'");
    if (r.result?.result?.value === true) return true;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  throw new Error("convert.js bundle did not load in the page");
}
await waitForHelpers();

const script = readFileSync(join(root, "tests/assertions.js"), "utf8");
const outcome = await evalInPage(`(() => { ${script} })()`);
const value = outcome.result?.result?.value;
const exception = outcome.result?.exceptionDetails;

ws.close();
child.kill();
server.close();
// Chrome can still hold the profile briefly after kill; cleanup is best-effort.
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}

if (exception) {
  console.error("FAIL — page threw:", exception.exception?.description || exception.text);
  process.exit(1);
}
for (const line of value.log) console.log(line);
if (!value.passed) process.exit(1);
console.log(`\n${value.log.filter((l) => l.startsWith("ok")).length} checks passed`);
