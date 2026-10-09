import { strToU8, zipSync } from "fflate";
import {
  asIso,
  buildAttachmentIndex,
  buildHonorAssetUrl,
  findImages,
  guessImageExtension,
  htmlToMarkdown,
  markdownEscape,
  resolveAttachment,
  safeName,
} from "./convert.js";

const API_BASE = "/portal/notepad";
const TEXT_ENCODER = new TextEncoder();
let activeExport = false;

function getCookie(name) {
  const prefix = `${name}=`;
  return document.cookie.split("; ").find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function createTraceId() {
  return crypto.randomUUID().replaceAll("-", "");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "HONOR_EXPORT_STATUS") {
    chrome.storage.local.get("honorExportState").then((state) => sendResponse(state.honorExportState || {}));
    return true;
  }
  if (message?.type !== "HONOR_EXPORT") return;
  chrome.storage.local.get("honorExportState").then(({ honorExportState }) => {
    if (activeExport) {
      sendResponse({ message: "导出任务正在运行，可关闭弹窗后稍后重新打开查看进度。" });
      return;
    }
    activeExport = true;
    chrome.storage.local.set({ honorExportState: { running: true, update: { phase: "list", label: "正在准备导出...", completed: 0, total: 0, images: 0, failures: 0 } } });
    sendResponse({ message: "任务已在笔记页面后台运行，可关闭此窗口。" });
    setTimeout(() => {
      exportNotes(message.limit ?? null)
        .then(() => chrome.storage.local.set({ honorExportState: { running: false, update: { phase: "package", label: "导出完成，ZIP 已下载。", completed: 1, total: 1, images: 0, failures: 0 } } }))
        .catch((error) => chrome.storage.local.set({ honorExportState: { running: false, update: { phase: "list", label: `Export failed: ${error.message}`, completed: 0, total: 0, images: 0, failures: 0 } } }))
        .finally(() => { activeExport = false; });
    }, 0);
  });
  return true;
});

function notifyProgress(phase, label, completed = 0, total = 0, images = 0, failures = 0) {
  chrome.storage.local.set({ honorExportState: { update: { phase, label, completed, total, images, failures }, running: true } });
  chrome.runtime.sendMessage({
    type: "HONOR_EXPORT_PROGRESS",
    update: { phase, label, completed, total, images, failures },
  }).catch(() => {});
}

const DB_NAME = "honor-notes-export";
let databasePromise = null;
function openDb() {
  // One cached connection for the whole export; opening a connection per write leaks handles.
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("entries");
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); databasePromise = null; };
        resolve(req.result);
      };
      req.onerror = () => { databasePromise = null; reject(req.error); };
    });
  }
  return databasePromise;
}
async function saveEntry(path, bytes) { const db = await openDb(); await new Promise((resolve, reject) => { const tx = db.transaction("entries", "readwrite"); tx.objectStore("entries").put(bytes, path); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function loadEntries() { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction("entries", "readonly"), out = {}; const req = tx.objectStore("entries").openCursor(); req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); }; req.onerror = () => reject(req.error); }); }

function archiveEntries(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([path]) => !path.startsWith("notes/") && path !== "export-report.json"));
}

async function post(path, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      // Honor's own web client supplies these headers for every note request.
      Csrftoken: getCookie("hc_CSRF_Token"),
      "x-hn-traceId": createTraceId(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} 请求失败（HTTP ${response.status}）`);
  return response.json();
}

function unwrapList(payload) {
  const candidates = [payload?.data?.data, payload?.data, payload?.data?.notes, payload?.notes];
  const notes = candidates.find(Array.isArray);
  if (!notes) throw new Error("列表接口未返回笔记数组，荣耀网页接口可能已变更。");
  return notes;
}

function unwrapDetails(payload) {
  const candidates = [payload?.data?.data, payload?.data, payload?.notes];
  const notes = candidates.find(Array.isArray);
  if (!notes) throw new Error("详情接口未返回笔记数组，荣耀网页接口可能已变更。");
  return notes;
}

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function fetchAsset(url) {
  const result = await chrome.runtime.sendMessage({ type: "HONOR_FETCH_ASSET", url });
  if (!result?.ok) throw new Error(result?.error || "扩展后台无法读取图片");
  const binary = atob(result.base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { bytes, contentType: result.contentType };
}

async function getFolders() {
  try {
    const payload = await post("note/initDataBase/getFolderList", {});
    const folders = unwrapList(payload);
    return new Map(folders.map((folder) => [folder.uuid, folder.display_name || folder.name || folder.uuid]));
  } catch (error) {
    console.warn("荣耀笔记文件夹读取失败，将使用 UUID：", error);
    return new Map();
  }
}

async function getDetails(ids, onBatch) {
  const details = [];
  for (let index = 0; index < ids.length; index += 20) {
    const payload = await post("noteDetail", { noteIds: ids.slice(index, index + 20) });
    details.push(...unwrapDetails(payload));
    onBatch?.(Math.min(index + 20, ids.length));
  }
  return details;
}

async function exportNotes(limit) {
  const startedAt = new Date().toISOString();
  notifyProgress("list", "正在读取完整笔记列表...");
  const [folders, listPayload] = await Promise.all([
    getFolders(),
    post("note/util/getNoteList", { queryType: 1, category: "total", searchContent: "" }),
  ]);
  const allNotes = unwrapList(listPayload).filter((note) => !note.delete_flag);
  const skippedHandwritten = allNotes.filter((note) => Number(note.type) === 1);
  const skippedLocked = allNotes.filter((note) => Number(note.type) !== 1 && Number(note.lock_status) > 0);
  const skipped = new Set([...skippedHandwritten, ...skippedLocked].map((note) => note.uuid));
  const selected = allNotes.filter((note) => !skipped.has(note.uuid)).slice(0, limit || allNotes.length);
  notifyProgress("details", `已找到 ${selected.length.toLocaleString()} 条笔记，正在读取正文...`, 0, selected.length);
  const detailById = new Map((await getDetails(selected.map((note) => note.uuid), (completed) => {
    notifyProgress("details", "正在读取笔记正文...", completed, selected.length);
  })).map((note) => [note.uuid, note]));
  const cache = await loadEntries();
  const archive = archiveEntries(cache);
  const report = {
    startedAt,
    listCount: allNotes.length,
    selectedCount: selected.length,
    exported: [],
    skippedHandwritten: skippedHandwritten.map((note) => note.uuid),
    skippedLocked: skippedLocked.map((note) => note.uuid),
    failures: [],
  };

  for (let noteIndex = 0; noteIndex < selected.length; noteIndex += 1) {
    const item = selected[noteIndex];
    notifyProgress("export", "正在转换 Markdown 和图片...", noteIndex, selected.length, Object.keys(archive).filter((path) => path.startsWith("assets/")).length, report.failures.length);
    const detail = detailById.get(item.uuid);
    if (!detail) {
      report.failures.push({ uuid: item.uuid, reason: "详情接口未返回该笔记" });
      continue;
    }
    if (cache[`notes/${item.uuid}.done`]) {
      report.exported.push({ uuid: item.uuid, resumed: true });
      continue;
    }
    const folderName = safeName(folders.get(detail.folder_uuid) || "未分类", "未分类");
    const title = safeName(detail.title || item.title || detail.summary || item.summary, `未命名-${item.uuid.slice(0, 8)}`);
    const uniqueBase = `${folderName}/${title}-${item.uuid.slice(0, 8)}`;
    const assetMap = new Map();
    const attachmentIndex = buildAttachmentIndex(detail.attachments, item.uuid);
    const images = findImages(detail.html_content);
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const source = images[imageIndex];
      notifyProgress(
        "export",
        `正在处理第 ${noteIndex + 1}/${selected.length} 条笔记的图片 ${imageIndex + 1}/${images.length}...`,
        noteIndex,
        selected.length,
        Object.keys(archive).filter((path) => path.startsWith("assets/")).length,
        report.failures.length,
      );
      try {
        const attachment = resolveAttachment(source, attachmentIndex);
        const resolvedUrl = attachment ? buildHonorAssetUrl(detail, attachment) : source;
        if (!resolvedUrl) throw new Error("详情中未找到图片附件信息");
        const { bytes, contentType } = await fetchAsset(resolvedUrl);
        const extension = guessImageExtension(bytes, contentType);
        const path = `assets/${item.uuid}-${String(imageIndex + 1).padStart(3, "0")}.${extension}`;
        archive[path] = bytes;
        await saveEntry(path, bytes);
        assetMap.set(source, `../${path}`);
      } catch (error) {
        report.failures.push({ uuid: item.uuid, image: source, reason: `图片下载失败：${error.message}` });
      }
    }
    const frontmatter = [
      "---",
      `honor_uuid: \"${markdownEscape(item.uuid)}\"`,
      `folder: \"${markdownEscape(folderName)}\"`,
      `created_at: ${asIso(detail.create_time || item.create_time) || "null"}`,
      `modified_at: ${asIso(detail.modify_time || item.modify_time) || "null"}`,
      `type: ${detail.type ?? item.type ?? "null"}`,
      "---",
      "",
      `# ${title}`,
      "",
    ].join("\n");
    archive[`${uniqueBase}.md`] = strToU8(`${frontmatter}${htmlToMarkdown(detail.html_content, assetMap)}\n`);
    await saveEntry(`${uniqueBase}.md`, archive[`${uniqueBase}.md`]);
    cache[`notes/${item.uuid}.done`] = new Uint8Array([1]);
    await saveEntry(`notes/${item.uuid}.done`, cache[`notes/${item.uuid}.done`]);
    report.exported.push({ uuid: item.uuid, path: `${uniqueBase}.md`, imageCount: images.length });
  }

  report.finishedAt = new Date().toISOString();
  notifyProgress("package", "正在生成 ZIP 文件...", selected.length, selected.length, Object.keys(archive).filter((path) => path.startsWith("assets/")).length, report.failures.length);
  archive["export-report.json"] = TEXT_ENCODER.encode(JSON.stringify(report, null, 2));
  download(zipSync(archive, { level: 6 }), `honor-notes-export-${new Date().toISOString().slice(0, 10)}.zip`);
  return `已导出 ${report.exported.length}/${selected.length} 条；跳过手写 ${skippedHandwritten.length} 条、锁定 ${skippedLocked.length} 条；失败 ${report.failures.length} 项。`;
}
