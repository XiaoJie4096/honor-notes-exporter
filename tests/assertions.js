// Assertions evaluated inside the headless page; window.__t is the bundled src/convert.js.
const { htmlToMarkdown, guessImageExtension, buildAttachmentIndex, resolveAttachment, safeName, asIso } = window.__t;
const log = [];
let passed = true;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) passed = false;
  log.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`}`);
}
function contains(name, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) passed = false;
  log.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     missing: ${JSON.stringify(needle)}\n     in:      ${JSON.stringify(haystack)}`}`);
}

const md = (html, map = new Map()) => htmlToMarkdown(html, map);

// --- headings, emphasis, links ---
check("h2 -> ##", md("<h2>项目排期</h2>"), "## 项目排期");
check("h3 -> ###", md("<h3>阶段一</h3>"), "### 阶段一");
check("bold", md("<p>这是<strong>重点</strong>内容</p>"), "这是**重点**内容");
check("italic", md("<p>这是<em>斜体</em></p>"), "这是*斜体*");
check("inline code", md("<p>用 <code>npm run build</code> 构建</p>"), "用 `npm run build` 构建");
check("link", md('<p>见 <a href="https://example.com">文档</a></p>'), "见 [文档](https://example.com)");

// --- lists ---
contains("unordered list", md("<ul><li>甲</li><li>乙</li></ul>"), "- 甲");
contains("ordered list", md("<ol><li>一</li></ol>"), "1. 一");

// --- table keeps its grid ---
const table = md("<table><tr><th>名称</th><th>状态</th></tr><tr><td>A</td><td>完成</td></tr></table>");
contains("table header row", table, "| 名称 | 状态 |");
contains("table separator", table, "| --- | --- |");
contains("table body row", table, "| A | 完成 |");

// --- code fence must not nest backticks ---
const fence = md("<pre><code>const a = 1;\nconst b = 2;</code></pre>");
contains("fenced block opens", fence, "```");
contains("fenced block keeps code", fence, "const a = 1;");
check("no nested backticks", fence.includes("`const a = 1;`"), false);

// --- images resolve through the asset map ---
const imgMap = new Map([["cid:IMG1", "../assets/n1-001.jpg"]]);
check("image uses asset map", md('<p><img src="cid:IMG1"></p>', imgMap), "![image](../assets/n1-001.jpg)");

// --- blank-line hygiene ---
check("collapses 3+ newlines", md("<p>甲</p><p></p><p></p><p>乙</p>"), "甲\n\n乙");
check("empty html", md(""), "");
check("null html", md(null), "");

// --- magic-byte sniffing: the octet-stream bug ---
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
check("jpeg mislabeled octet-stream -> jpg", guessImageExtension(jpeg, "application/octet-stream"), "jpg");
check("png mislabeled octet-stream -> png", guessImageExtension(png, "application/octet-stream"), "png");
check("gif sniffed", guessImageExtension(gif, "application/octet-stream"), "gif");
check("webp sniffed", guessImageExtension(webp, "application/octet-stream"), "webp");
check("unknown bytes fall back to png", guessImageExtension(new Uint8Array([1, 2, 3]), ""), "png");
check("jpeg via content-type only", guessImageExtension(new Uint8Array([1, 2, 3]), "image/jpeg"), "jpg");

// --- original vs preview pairing ---
const attachments = [
  { uuid: "prev1", filename: "abc_100_100_1700000000000.png", parent_uuid: "note1" },
  { uuid: "orig1", filename: "abc_100_100_1700000000000_original.png", parent_uuid: "note1" },
  { uuid: "solo", filename: "zzz_5_5_1.png", parent_uuid: "note1" },
  { uuid: "foreign", filename: "abc_100_100_1700000000000_original.png", parent_uuid: "otherNote" },
];
const index = buildAttachmentIndex(attachments, "note1");
check("preview cid resolves to original", resolveAttachment("cid:prev1", index).uuid, "orig1");
check("original cid resolves to itself", resolveAttachment("cid:orig1", index).uuid, "orig1");
check("unpaired image resolves directly", resolveAttachment("cid:solo", index).uuid, "solo");
check("foreign-note attachment is excluded", index.byId.has("foreign"), false);
check("non-cid source resolves to null", resolveAttachment("https://x/y.png", index), null);
check("unknown cid falls back to null", resolveAttachment("cid:nope", index), null);

// --- misc helpers ---
check("safeName strips path characters", safeName('a/b\\c:d*e?f"g<h>i|j', "x"), "a_b_c_d_e_f_g_h_i_j");
check("safeName falls back when empty", safeName("", "未命名"), "未命名");
check("safeName truncates to 100", safeName("あ".repeat(200), "x").length, 100);
check("asIso formats ms epoch", asIso(1700000000000), new Date(1700000000000).toISOString());
check("asIso rejects junk", asIso("nonsense"), null);

return { log, passed };
