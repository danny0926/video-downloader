// 偵測分頁裡的影片來源，整理成「一個影片一個項目」，不列出串流小片段。
// 項目種類:
//   vimeo  - 嵌入的 Vimeo 播放器 (整支影片只有一個項目，下載交給本機 yt-dlp)
//   stream - m3u8 / mpd 播放清單 (交給本機 yt-dlp)；role=master 是總清單，variant 是單一畫質子清單
//   file   - 單一 mp3/mp4 等檔案 (直接用 Chrome 下載)
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|flac|mp4|webm|m3u8|mpd)(\?|$)/i;
const STREAM_EXT = /\.(m3u8|mpd)(\?|$)/i;
const SEGMENT = /\.(ts|m4s)(\?|$)|\/range\/|[?&]range=|\.vimeocdn\.com|\.akamaized\.net.*\/(segment|chunk)/i;
const VIMEO_PLAYER = /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i;

async function getList(tabId) {
  const key = `tab${tabId}`;
  return (await chrome.storage.session.get(key))[key] || [];
}

async function setList(tabId, list) {
  await chrome.storage.session.set({ [`tab${tabId}`]: list });
  chrome.action.setBadgeText({ tabId, text: list.length ? String(list.length) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a9e6f" });
}

async function add(tabId, item) {
  const list = await getList(tabId);
  if (list.some((x) => x.id === item.id)) return false;
  list.push(item);
  await setList(tabId, list);
  return true;
}

async function patch(tabId, id, fields) {
  const list = await getList(tabId);
  const it = list.find((x) => x.id === id);
  if (it) {
    Object.assign(it, fields);
    await setList(tabId, list);
  }
}

async function tabInfo(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    return { referer: t.url || "", title: t.title || "" };
  } catch {
    return { referer: "", title: "" };
  }
}

// 讀 m3u8 內容：判斷是總清單還是單一畫質，並算出影片長度與可用畫質
async function describeStream(tabId, id, url) {
  const dur = (txt) => [...txt.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + parseFloat(m[1]), 0);
  try {
    const txt = await (await fetch(url, { credentials: "include" })).text();
    if (txt.includes("#EXT-X-STREAM-INF")) {
      const heights = [...txt.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => +m[1]);
      const lines = txt.split(/\r?\n/);
      const i = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
      let duration = 0;
      const sub = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
      if (sub) {
        try {
          duration = dur(await (await fetch(new URL(sub, url), { credentials: "include" })).text());
        } catch {}
      }
      await patch(tabId, id, { role: "master", maxHeight: Math.max(0, ...heights), duration });
    } else if (txt.includes("#EXTINF")) {
      await patch(tabId, id, { role: "variant", duration: dur(txt) });
    }
  } catch {}
}

// Vimeo 嵌入播放器 (iframe)
chrome.webRequest.onBeforeRequest.addListener(
  async (d) => {
    const m = d.url.match(VIMEO_PLAYER);
    if (d.tabId < 0 || !m) return;
    const t = await tabInfo(d.tabId);
    add(d.tabId, { id: `vimeo:${m[1]}`, kind: "vimeo", url: d.url, label: "Vimeo 影片", ...t });
  },
  { urls: ["*://player.vimeo.com/video/*"], types: ["sub_frame"] }
);

// bilibili：影片是分段 .m4s (影音分開)，抓不到完整清單，改用「頁面網址」交給 yt-dlp
const BILI_PAGE = /^https?:\/\/(www\.)?bilibili\.com\/(video\/[A-Za-z0-9]+|bangumi\/play\/\w+)/i;
async function detectBilibili(d) {
  if (d.tabId < 0 || !/\.m4s(\?|$)|bilivideo\.com/i.test(d.url)) return false;
  const t = await tabInfo(d.tabId);
  const m = t.referer.match(BILI_PAGE);
  if (!m) return false;
  // 只保留到 /video/BVxxx (去掉 spm 等追蹤參數；分 P 的 ?p= 保留)
  const u = new URL(t.referer);
  const p = u.searchParams.get("p");
  const page = `${u.origin}${u.pathname}${p ? `?p=${p}` : ""}`;
  add(d.tabId, { id: `bilibili:${u.pathname}${p || ""}`, kind: "site", url: page, label: "bilibili 影片", referer: page, title: t.title });
  return true;
}

// 其他單一檔案 / 串流清單
chrome.webRequest.onResponseStarted.addListener(
  async (d) => {
    if (d.tabId < 0) return;
    if (await detectBilibili(d)) return;
    if (SEGMENT.test(d.url)) return;
    const ct = (d.responseHeaders || []).find((h) => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
    const isStream = STREAM_EXT.test(d.url) || ct.includes("mpegurl") || ct.includes("dash+xml");
    const isFile = ct.startsWith("audio/") || ct.startsWith("video/") || MEDIA_EXT.test(d.url);
    if (!isStream && !isFile) return;
    const id = `${isStream ? "stream" : "file"}:${d.url.split("?")[0]}`;
    const t = await tabInfo(d.tabId);
    const fresh = await add(d.tabId, {
      id,
      kind: isStream ? "stream" : "file",
      url: d.url,
      label: isStream ? "串流影片" : ct.startsWith("audio/") ? "音訊檔" : "影片檔",
      ...t,
    });
    if (fresh && isStream) describeStream(d.tabId, id, d.url);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

function clearTab(tabId) {
  chrome.storage.session.remove(`tab${tabId}`);
  chrome.action.setBadgeText({ tabId, text: "" });
}

// 一般換頁 / 重新整理：主框架提交導航時清空 (早於該頁的 iframe/媒體請求，不會誤刪)
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) clearTab(d.tabId);
});

// 單頁式網站 (SPA) 切換影片：網址路徑改變但頁面沒重新載入，也要清空
const lastPath = {};
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  const path = new URL(d.url).pathname;
  if (lastPath[d.tabId] !== undefined && lastPath[d.tabId] !== path) clearTab(d.tabId);
  lastPath[d.tabId] = path;
});
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) lastPath[d.tabId] = new URL(d.url).pathname;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab${tabId}`);
  delete lastPath[tabId];
});
