const SERVER = "http://127.0.0.1:18765";
const HEADERS = { "X-Media-Sniffer": "1", "Content-Type": "application/json" };
const listEl = document.getElementById("list");
let tab;

function cleanTitle(t) {
  return (t || "video").replace(/\s*[|\-–—]\s*[^|\-–—]*$/, "").trim() || t;
}

async function serverUp() {
  try {
    return (await fetch(SERVER + "/", { headers: HEADERS })).ok;
  } catch {
    return false;
  }
}

async function jobs() {
  try {
    return await (await fetch(SERVER + "/jobs", { headers: HEADERS })).json();
  } catch {
    return {};
  }
}

function fileName(url) {
  const n = decodeURIComponent(new URL(url).pathname.split("/").pop() || "media");
  return n.replace(/[\\/:*?"<>|]/g, "_");
}

function render(items) {
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">還沒偵測到影片。<br>請先在頁面按下播放鍵，再回來看這裡。</div>';
    return;
  }
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${it.label}：${cleanTitle(tab.title)}`;
    const status = document.createElement("div");
    status.className = "status";
    const btn = document.createElement("button");
    btn.textContent = "下載";
    div.append(title, btn, status);
    listEl.append(div);

    btn.onclick = async () => {
      if (it.kind === "file") {
        chrome.downloads.download({ url: it.url, filename: fileName(it.url), saveAs: true });
        status.textContent = "已交給 Chrome 下載";
        return;
      }
      if (!(await serverUp())) {
        status.textContent = "找不到本機下載服務，請先雙擊 start_server.bat 再試一次。";
        return;
      }
      btn.disabled = true;
      const r = await fetch(SERVER + "/download", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ url: it.url, referer: it.referer, title: cleanTitle(tab.title) }),
      });
      const { id } = await r.json();
      const timer = setInterval(async () => {
        const j = (await jobs())[id];
        if (!j) return;
        if (j.state === "downloading" || j.state === "queued") status.textContent = `下載中… ${j.percent}%`;
        if (j.state === "done") {
          status.textContent = `完成：downloads/${j.file}`;
          clearInterval(timer);
        }
        if (j.state === "error") {
          status.textContent = "失敗：" + j.error;
          btn.disabled = false;
          clearInterval(timer);
        }
      }, 1000);
    };
  }
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = `tab${tab.id}`;
  render((await chrome.storage.session.get(key))[key] || []);
})();
