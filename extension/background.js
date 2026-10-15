// 監聽媒體請求，依分頁記錄；資料放 storage.session，service worker 休眠也不會掉。
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|flac|mp4|webm|m3u8|mpd)(\?|$)/i;
const SEGMENT_EXT = /\.(ts|m4s)(\?|$)/i;

function isMedia(details) {
  if (SEGMENT_EXT.test(details.url)) return false;
  const ct = (details.responseHeaders || [])
    .find((h) => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
  return ct.startsWith("audio/") || ct.startsWith("video/") || ct.includes("mpegurl") || MEDIA_EXT.test(details.url)
    ? ct || "unknown"
    : null;
}

async function add(tabId, item) {
  const key = `tab${tabId}`;
  const list = (await chrome.storage.session.get(key))[key] || [];
  if (list.some((x) => x.url === item.url)) return;
  list.push(item);
  await chrome.storage.session.set({ [key]: list });
  chrome.action.setBadgeText({ tabId, text: String(list.length) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a9e6f" });
}

chrome.webRequest.onResponseStarted.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const ct = isMedia(d);
    if (ct) add(d.tabId, { url: d.url, type: ct, time: Date.now() });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 換頁就清空該分頁的清單
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    chrome.storage.session.remove(`tab${tabId}`);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab${tabId}`));
