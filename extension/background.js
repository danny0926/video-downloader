// 偵測分頁裡的影片來源，整理成「一個影片一個項目」，不列出串流小片段。
// 項目種類:
//   vimeo  - 嵌入的 Vimeo 播放器 (整支影片只有一個項目，下載交給本機 yt-dlp)
//   stream - m3u8 / mpd 播放清單 (交給本機 yt-dlp)
//   file   - 單一 mp3/mp4 等檔案 (直接用 Chrome 下載)
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|flac|mp4|webm|m3u8|mpd)(\?|$)/i;
const STREAM_EXT = /\.(m3u8|mpd)(\?|$)/i;
const SEGMENT = /\.(ts|m4s)(\?|$)|\/range\/|[?&]range=|\.vimeocdn\.com|\.akamaized\.net.*\/(segment|chunk)/i;
const VIMEO_PLAYER = /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i;

async function add(tabId, item) {
  const key = `tab${tabId}`;
  const list = (await chrome.storage.session.get(key))[key] || [];
  if (list.some((x) => x.id === item.id)) return;
  list.push(item);
  await chrome.storage.session.set({ [key]: list });
  chrome.action.setBadgeText({ tabId, text: String(list.length) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a9e6f" });
}

async function referer(tabId) {
  try {
    return (await chrome.tabs.get(tabId)).url || "";
  } catch {
    return "";
  }
}

// Vimeo 嵌入播放器 (iframe)
chrome.webRequest.onBeforeRequest.addListener(
  async (d) => {
    const m = d.url.match(VIMEO_PLAYER);
    if (d.tabId < 0 || !m) return;
    add(d.tabId, { id: `vimeo:${m[1]}`, kind: "vimeo", url: d.url, referer: await referer(d.tabId), label: "Vimeo 影片" });
  },
  { urls: ["*://player.vimeo.com/video/*"], types: ["sub_frame"] }
);

// 其他單一檔案 / 串流清單
chrome.webRequest.onResponseStarted.addListener(
  async (d) => {
    if (d.tabId < 0 || SEGMENT.test(d.url)) return;
    const ct = (d.responseHeaders || []).find((h) => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
    const isStream = STREAM_EXT.test(d.url) || ct.includes("mpegurl") || ct.includes("dash+xml");
    const isFile = ct.startsWith("audio/") || ct.startsWith("video/") || MEDIA_EXT.test(d.url);
    if (!isStream && !isFile) return;
    const base = d.url.split("?")[0];
    add(d.tabId, {
      id: `${isStream ? "stream" : "file"}:${base}`,
      kind: isStream ? "stream" : "file",
      url: d.url,
      referer: await referer(d.tabId),
      label: isStream ? "串流影片" : ct.startsWith("audio/") ? "音訊檔" : "影片檔",
    });
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
