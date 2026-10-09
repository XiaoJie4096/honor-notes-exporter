chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "HONOR_FETCH_ASSET") return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  (async () => {
    try {
      const response = await fetch(message.url, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Chunked conversion: one spread call over every byte overflows the argument limit on large images.
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      sendResponse({ ok: true, contentType: response.headers.get("content-type") || "", base64: btoa(binary) });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.name === "AbortError" ? "图片下载超时（30 秒）" : (error?.message || "图片下载失败"),
      });
    } finally {
      clearTimeout(timeout);
    }
  })();
  return true;
});
