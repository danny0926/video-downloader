"""開瀏覽器、等你按播放，抓出頁面載入的音訊/影片網址並下載 (類似 Chrome 下載外掛的原理)。

用法:
    python sniff.py URL
第一次會要你在跳出的視窗登入；登入狀態存在 .profile/，之後不用再登入。
按下播放鍵後，腳本偵測到媒體請求就會自動下載到 downloads/，按 Ctrl+C 結束。
"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
PROFILE = ROOT / ".profile"
OUT_DIR = ROOT / "downloads"
MEDIA_EXT = re.compile(r"\.(mp3|m4a|aac|wav|ogg|flac|mp4|webm|m3u8|mpd)(\?|$)", re.I)
STREAM_EXT = re.compile(r"\.(m3u8|mpd)(\?|$)", re.I)
SKIP = re.compile(r"\.(ts|m4s)(\?|$)", re.I)  # 串流分片，交給 m3u8 處理


def is_media(resp):
    ctype = resp.headers.get("content-type", "").lower()
    url = resp.url
    if SKIP.search(url):
        return False
    return ctype.startswith(("audio/", "video/")) or "mpegurl" in ctype or bool(MEDIA_EXT.search(url))


def save_name(url, ctype):
    name = unquote(Path(urlparse(url).path).name) or "media"
    if "." not in name:
        name += "." + (ctype.split("/")[-1].split(";")[0] or "bin")
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def write_cookies(ctx, path):
    lines = ["# Netscape HTTP Cookie File"]
    for c in ctx.cookies():
        dom = c["domain"]
        lines.append("\t".join([
            dom, "TRUE" if dom.startswith(".") else "FALSE", c["path"],
            "TRUE" if c["secure"] else "FALSE", str(int(c["expires"])) if c["expires"] > 0 else "0",
            c["name"], c["value"],
        ]))
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    page_url = sys.argv[1]
    OUT_DIR.mkdir(exist_ok=True)
    seen = set()

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE), channel="chrome", headless=False, viewport={"width": 1280, "height": 900}
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def handle(resp):
            if resp.url in seen or not is_media(resp):
                return
            seen.add(resp.url)
            ctype = resp.headers.get("content-type", "")
            print(f"[抓到媒體] {resp.url}  ({ctype})")
            try:
                if STREAM_EXT.search(resp.url) or "mpegurl" in ctype.lower():
                    cj = ROOT / ".profile" / "cookies.txt"
                    write_cookies(ctx, cj)
                    subprocess.run([
                        sys.executable, "-m", "yt_dlp", "--cookies", str(cj),
                        "--referer", page_url, "-o", str(OUT_DIR / "%(title)s.%(ext)s"), resp.url,
                    ])
                else:
                    # 重新完整抓一次 (播放器常用 Range 只拿一部分)
                    full = ctx.request.get(resp.url, headers={"Referer": page_url})
                    dest = OUT_DIR / save_name(resp.url, ctype)
                    dest.write_bytes(full.body())
                    print(f"[已儲存] {dest}  ({dest.stat().st_size / 1e6:.1f} MB)")
            except Exception as e:  # noqa: BLE001
                print(f"[下載失敗] {e}")

        ctx.on("response", handle)
        page.goto(page_url)
        print("請在視窗中登入(若需要)，然後按下播放鍵。抓到後會自動下載；Ctrl+C 結束。")
        try:
            while True:
                page.wait_for_timeout(1000)
        except (KeyboardInterrupt, Exception):  # 視窗被關閉也結束
            pass
        ctx.close()


if __name__ == "__main__":
    main()
