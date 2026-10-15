const listEl = document.getElementById("list");

function fileName(url, type) {
  let name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "media");
  if (!name.includes(".")) name += "." + (type.split("/").pop().split(";")[0] || "bin");
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function render(items) {
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">還沒偵測到媒體。<br>請先在頁面按下播放鍵，再回來看這裡。</div>';
    return;
  }
  for (const it of items.slice().reverse()) {
    const isStream = /\.(m3u8|mpd)(\?|$)/i.test(it.url) || it.type.includes("mpegurl");
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = '<div class="url"></div><div class="row"><span class="type"></span></div>';
    div.querySelector(".url").textContent = it.url;
    div.querySelector(".type").textContent = it.type + (isStream ? "（串流，需用 yt-dlp）" : "");
    const row = div.querySelector(".row");

    const copy = document.createElement("button");
    copy.textContent = isStream ? "複製 yt-dlp 指令" : "複製網址";
    copy.onclick = async () => {
      await navigator.clipboard.writeText(isStream ? `yt-dlp "${it.url}"` : it.url);
      copy.textContent = "已複製";
    };
    row.append(copy);

    if (!isStream) {
      const dl = document.createElement("button");
      dl.textContent = "下載";
      dl.onclick = () => {
        chrome.downloads.download({ url: it.url, filename: fileName(it.url, it.type), saveAs: true });
        dl.textContent = "已送出";
      };
      row.append(dl);
    }
    listEl.append(div);
  }
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = `tab${tab.id}`;
  render((await chrome.storage.session.get(key))[key] || []);
})();
