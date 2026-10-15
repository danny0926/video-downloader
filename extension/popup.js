const SERVER = "http://127.0.0.1:18765";
const HEADERS = { "X-Media-Sniffer": "1", "Content-Type": "application/json" };
const listEl = document.getElementById("list");
const jobsEl = document.getElementById("jobs");
const STATE_TEXT = { queued: "等待中", downloading: "下載中", done: "已完成", error: "失敗" };
let tab;

function cleanTitle(t) {
  return (t || "video").replace(/\s*[|\-–—]\s*[^|\-–—]*$/, "").trim() || t;
}

async function call(path, method = "GET", body) {
  const r = await fetch(SERVER + path, { method, headers: HEADERS, body: body && JSON.stringify(body) });
  return r.json();
}

async function serverUp() {
  try {
    await call("/");
    return true;
  } catch {
    return false;
  }
}

function fileName(url) {
  const n = decodeURIComponent(new URL(url).pathname.split("/").pop() || "media");
  return n.replace(/[\\/:*?"<>|]/g, "_");
}

// ── 本頁偵測到的影片 ──────────────────────────────────────────
function renderDetected(items) {
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
      await call("/download", "POST", { url: it.url, referer: it.referer, title: cleanTitle(tab.title) });
      status.textContent = "已加入下載清單，可以關掉這個視窗，下載會繼續。";
      refreshJobs();
    };
  }
}

// ── 下載清單 (所有分頁共用，重新整理頁面不會消失) ───────────────────
async function refreshJobs() {
  let all;
  try {
    all = await call("/jobs");
  } catch {
    jobsEl.innerHTML = '<div class="empty">本機下載服務未啟動，請先雙擊 start_server.bat。</div>';
    return;
  }
  const jobs = Object.values(all).sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!jobs.length) {
    jobsEl.innerHTML = '<div class="empty">目前沒有下載任務。</div>';
    return;
  }
  jobsEl.innerHTML = "";
  for (const j of jobs) {
    const div = document.createElement("div");
    div.className = "job";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = j.file || j.title || j.url;
    const st = document.createElement("div");
    st.className = `state ${j.state}`;
    st.textContent =
      STATE_TEXT[j.state] +
      (j.state === "downloading" ? ` ${j.percent}%` : "") +
      (j.state === "error" ? `：${j.error || ""}` : "");
    div.append(name, st);
    if (j.state === "downloading") {
      div.insertAdjacentHTML("beforeend", `<div class="bar"><div style="width:${j.percent}%"></div></div>`);
    }
    jobsEl.append(div);
  }
}

document.getElementById("open").onclick = () => call("/open", "POST").catch(() => {});
document.getElementById("clear").onclick = () => call("/clear", "POST").then(refreshJobs).catch(() => {});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = `tab${tab.id}`;
  renderDetected((await chrome.storage.session.get(key))[key] || []);
  refreshJobs();
  setInterval(refreshJobs, 1000);
})();
