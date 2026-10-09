const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const detail = document.querySelector("#detail");
const buttons = [...document.querySelectorAll("button")];

const phasePercent = {
  list: 4,
  details: 10,
  export: 58,
  package: 98,
};

function updateProgress(update) {
  const base = phasePercent[update.phase] ?? 0;
  const span = update.phase === "details" ? 48 : update.phase === "export" ? 38 : 2;
  const ratio = update.total ? update.completed / update.total : 0;
  progress.hidden = false;
  detail.hidden = false;
  progress.value = Math.min(99, base + span * ratio);
  status.textContent = update.label;
  detail.textContent = update.total ? `${update.completed.toLocaleString()} / ${update.total.toLocaleString()} 条，图片 ${update.images || 0}，失败 ${update.failures || 0}` : "";
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "HONOR_EXPORT_PROGRESS") updateProgress(message.update);
});

async function getHonorTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://cloud.honor.com/portal/notepad")) {
    throw new Error("请切换到已登录的荣耀云笔记页面后再导出。");
  }
  return tab;
}

async function startExport(limit) {
  buttons.forEach((button) => { button.disabled = true; });
  progress.value = 0;
  progress.hidden = false;
  detail.hidden = false;
  detail.textContent = "正在准备...";
  try {
    const tab = await getHonorTab();
    status.textContent = "正在连接荣耀笔记...";
    const result = await chrome.tabs.sendMessage(tab.id, { type: "HONOR_EXPORT", limit });
    status.textContent = result?.message || "任务已在笔记页面后台运行，可关闭此窗口。";
  } catch (error) {
    status.textContent = error.message || String(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function refreshStatus() {
  try {
    const tab = await getHonorTab();
    const state = await chrome.tabs.sendMessage(tab.id, { type: "HONOR_EXPORT_STATUS" });
    if (state?.update) updateProgress(state.update);
    if (state?.running) buttons.forEach((button) => { button.disabled = true; });
  } catch {}
}

document.querySelector("#sample").addEventListener("click", () => startExport(10));
document.querySelector("#all").addEventListener("click", () => startExport(null));
refreshStatus();
setInterval(refreshStatus, 1000);
