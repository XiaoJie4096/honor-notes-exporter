// Pure helpers shared by the content script and the test harness.
// Kept free of chrome.* APIs so they can be exercised directly in a DOM environment.

export function safeName(value, fallback) {
  const name = String(value || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (name || fallback).slice(0, 100);
}

export function markdownEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function asIso(timestamp) {
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildHonorAssetUrl(note, attachment) {
  if (!note?.unstruct_guid || !attachment?.filename) return null;
  const noteId = encodeURIComponent(note.unstruct_guid);
  const filename = encodeURIComponent(attachment.filename);
  return `https://fileproxy-drcn.cloud.honor.com/portal/notepad/file/singleFileDownstream?cloudPath=/sync/notepad/${noteId}/${filename}`;
}

export function findImages(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const sources = [...doc.images].map((image) => image.getAttribute("src")).filter(Boolean);
  for (const node of doc.querySelectorAll("[hid], [data-cid]")) {
    const id = node.getAttribute("hid") || node.getAttribute("data-cid");
    if (id) sources.push(`cid:${id}`);
  }
  return [...new Set(sources)];
}

function isOriginal(attachment) {
  return String(attachment?.filename || "").includes("_original.");
}

export function buildAttachmentIndex(attachments, noteId) {
  const byId = new Map();
  const byPrefix = new Map();
  for (const attachment of attachments || []) {
    if (!attachment?.filename) continue;
    // Honour the note an attachment belongs to; a mismatched parent means a changed payload.
    if (attachment.parent_uuid && noteId && attachment.parent_uuid !== noteId) continue;
    byId.set(attachment.uuid, attachment);
    const prefix = String(attachment.filename).split("_")[0];
    if (!prefix) continue;
    const current = byPrefix.get(prefix);
    // Honor stores each image twice: a scaled preview and the "_original" upload.
    // The editor embeds the preview, so prefer the original for a faithful export.
    if (!current || (isOriginal(attachment) && !isOriginal(current))) byPrefix.set(prefix, attachment);
  }
  return { byId, byPrefix };
}

export function resolveAttachment(source, index) {
  if (!source.startsWith("cid:")) return null;
  const id = source.slice(4);
  const direct = index.byId.get(id);
  const prefix = String(direct?.filename || id).split("_")[0];
  return index.byPrefix.get(prefix) || direct || null;
}

export function guessImageExtension(bytes, contentType) {
  // Honor's file service often answers with application/octet-stream, so trust magic bytes first:
  // otherwise every JPEG is written as a .png and viewers refuse to render it.
  const startsWith = (signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith([0x42, 0x4d])) return "bmp";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) return "heic";
  if (String(contentType).includes("jpeg")) return "jpg";
  if (String(contentType).includes("webp")) return "webp";
  if (String(contentType).includes("gif")) return "gif";
  return "png";
}

export function htmlToMarkdown(html, assetMap) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");

  for (const image of doc.querySelectorAll("img")) {
    const source = image.getAttribute("src") || "";
    image.replaceWith(`\n![${image.getAttribute("alt") || "image"}](${assetMap.get(source) || source})\n`);
  }
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");

  // Honour's editor emits its own heading/emphasis structure; map it rather than dropping to text.
  for (let level = 1; level <= 6; level += 1) {
    for (const heading of doc.querySelectorAll(`h${level}`)) {
      heading.replaceWith(`\n${"#".repeat(level)} ${heading.textContent.trim()}\n`);
    }
  }
  for (const strong of doc.querySelectorAll("strong, b")) strong.replaceWith(`**${strong.textContent}**`);
  for (const em of doc.querySelectorAll("em, i")) em.replaceWith(`*${em.textContent}*`);
  // Fenced blocks first: a <pre> usually wraps a <code>, which would otherwise nest backticks.
  for (const pre of doc.querySelectorAll("pre")) pre.replaceWith(`\n\`\`\`\n${pre.textContent.replace(/\n+$/, "")}\n\`\`\`\n`);
  for (const code of doc.querySelectorAll("code")) code.replaceWith(`\`${code.textContent}\``);
  for (const link of doc.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    const text = link.textContent.trim();
    link.replaceWith(href ? `[${text || href}](${href})` : text);
  }

  // Tables lose their grid if we only read textContent, so emit a Markdown table.
  for (const table of doc.querySelectorAll("table")) {
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.querySelectorAll("th, td")].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));
    if (!rows.length) { table.remove(); continue; }
    const width = Math.max(...rows.map((row) => row.length));
    const pad = (row) => [...row, ...Array(width - row.length).fill("")];
    const lines = [
      `| ${pad(rows[0]).join(" | ")} |`,
      `| ${Array(width).fill("---").join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${pad(row).join(" | ")} |`),
    ];
    table.replaceWith(`\n${lines.join("\n")}\n`);
  }

  for (const item of doc.querySelectorAll("li")) {
    const marker = item.closest("ol") ? "1. " : "- ";
    item.replaceWith(`${marker}${item.textContent.trim()}\n`);
  }
  for (const quote of doc.querySelectorAll("blockquote")) {
    quote.replaceWith(`${quote.textContent.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n`);
  }
  for (const block of doc.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote")) block.append("\n");

  return (doc.body.textContent || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
