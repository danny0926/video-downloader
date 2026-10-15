"""本機下載服務：Chrome 外掛把網址送來，這裡用 yt-dlp 下載並合併成 mp4。

啟動: python server.py   (或雙擊 start_server.bat；開機自動啟動用 pythonw)
只綁定 127.0.0.1；要求自訂 header，避免被其他網頁的跨站請求觸發。
同時最多下載 MAX_PARALLEL 個，其餘排隊。下載紀錄存在專案資料夾的 jobs.json，成品存到 Windows「下載」資料夾。
"""
import json
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import imageio_ffmpeg
import yt_dlp

HOST, PORT = "127.0.0.1", 18765
MAX_PARALLEL = 2
ROOT = Path(__file__).parent
TMP_DIR = ROOT / ".tmp"          # 下載中的暫存檔 (完成後自動清掉)
STORE = ROOT / "jobs.json"       # 下載清單紀錄


def windows_downloads_dir():
    """Windows「下載」資料夾 (Chrome 預設下載位置)；取不到就退回 ~/Downloads。"""
    try:
        import ctypes
        from ctypes import wintypes
        guid = ctypes.c_buffer(16)
        ctypes.windll.ole32.CLSIDFromString("{374DE290-123F-4565-9164-39C4925E467B}", guid)
        path = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(guid, 0, wintypes.HANDLE(0), ctypes.byref(path)) == 0:
            return Path(path.value)
    except Exception:  # noqa: BLE001
        pass
    return Path.home() / "Downloads"


OUT_DIR = windows_downloads_dir()
JOBS = {}  # id -> {title, url, state, percent, file, error, created}
LOCK = threading.Lock()
SLOTS = threading.Semaphore(MAX_PARALLEL)


def save_jobs():
    with LOCK:
        try:
            STORE.write_text(json.dumps(JOBS, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass


def load_jobs():
    try:
        data = json.loads(STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for job in data.values():
        if job.get("state") in ("queued", "downloading"):  # 上次服務被關掉時沒做完的
            job["state"], job["error"] = "error", "服務重啟，下載中斷"
    JOBS.update(data)


def safe_title(title):
    title = re.sub(r'[\\/:*?"<>|\r\n]', "_", title or "video").strip()[:120] or "video"
    return title.replace("%", "%%")  # yt-dlp 輸出樣板裡 % 需跳脫


def run_job(job_id, url, referer, title):
    job = JOBS[job_id]
    with SLOTS:  # 超過並行上限的任務停在 queued，等前面的做完
        def hook(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                if total:
                    job["percent"] = round(d["downloaded_bytes"] * 100 / total, 1)

        opts = {
            "paths": {"home": str(OUT_DIR), "temp": str(TMP_DIR)},
            "outtmpl": f"{safe_title(title)}.%(ext)s",
            "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
            "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "windowsfilenames": True,
            "concurrent_fragment_downloads": 4,
            "retries": 10,
            "overwrites": True,  # 重新下載時覆蓋舊檔，而不是直接跳過
            "quiet": True,
            "noprogress": True,
            "progress_hooks": [hook],
            "http_headers": {"Referer": referer} if referer else {},
        }
        try:
            job["state"] = "downloading"
            save_jobs()
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                job["file"] = Path(ydl.prepare_filename(info)).with_suffix(".mp4").name
            job["percent"], job["state"] = 100.0, "done"
        except Exception as e:  # noqa: BLE001
            job["state"], job["error"] = "error", str(e)[:300]
        save_jobs()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        return self.headers.get("X-Media-Sniffer") == "1"

    def do_GET(self):
        if not self._authorized():
            return self._send(403, {"error": "forbidden"})
        if self.path == "/jobs":
            return self._send(200, JOBS)
        self._send(200, {"ok": True})  # 健康檢查

    def do_POST(self):
        if not self._authorized():
            return self._send(403, {"error": "forbidden"})
        if self.path == "/open":  # 開啟下載資料夾
            os.startfile(OUT_DIR)
            return self._send(200, {"ok": True})
        if self.path == "/clear":  # 清除已完成/失敗的紀錄 (不刪影片檔)
            for k in [k for k, j in JOBS.items() if j["state"] in ("done", "error")]:
                del JOBS[k]
            save_jobs()
            return self._send(200, {"ok": True})
        if self.path != "/download":
            return self._send(404, {"error": "not found"})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            url = data["url"]
            if urlparse(url).scheme not in ("http", "https"):
                raise ValueError("bad url")
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "bad request"})
        for jid, j in JOBS.items():  # 同一個網址已在排隊/下載中就不重複建立
            if j["url"] == url and j["state"] in ("queued", "downloading"):
                return self._send(200, {"id": jid})
        job_id = uuid.uuid4().hex[:8]
        JOBS[job_id] = {
            "title": data.get("title", ""), "url": url, "state": "queued",
            "percent": 0.0, "created": time.time(),
        }
        save_jobs()
        threading.Thread(
            target=run_job, args=(job_id, url, data.get("referer", ""), data.get("title", "")), daemon=True
        ).start()
        self._send(200, {"id": job_id})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    OUT_DIR.mkdir(exist_ok=True)
    TMP_DIR.mkdir(exist_ok=True)
    load_jobs()
    print(f"下載服務已啟動 http://{HOST}:{PORT}  輸出資料夾: {OUT_DIR}\n關閉此視窗即停止。")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
