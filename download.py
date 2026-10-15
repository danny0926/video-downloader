"""用 yt-dlp 下載網路影片的簡易包裝。

用法:
    python download.py URL [URL ...]
    python download.py URL --audio              # 只抓音訊 (mp3)
    python download.py URL --quality 720        # 最高 720p
    python download.py URL --browser chrome     # 用 Chrome 登入狀態 (會員/年齡限制影片)
    python download.py URL --list               # 只列出可用格式
"""
import argparse
import sys
from pathlib import Path

import imageio_ffmpeg
import yt_dlp

OUT_DIR = Path(__file__).parent / "downloads"


def build_opts(args):
    opts = {
        "outtmpl": str(OUT_DIR / "%(title).150B [%(id)s].%(ext)s"),
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "noplaylist": not args.playlist,
        "windowsfilenames": True,
        "concurrent_fragment_downloads": 4,
        "retries": 10,
    }
    if args.audio:
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
    else:
        opts["format"] = f"bv*[height<={args.quality}]+ba/b[height<={args.quality}]"
        opts["merge_output_format"] = "mp4"
    if args.browser:
        opts["cookiesfrombrowser"] = (args.browser,)
    if args.list:
        opts["listformats"] = True
        opts["skip_download"] = True
    return opts


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("urls", nargs="+")
    p.add_argument("--audio", action="store_true", help="只下載音訊並轉 mp3")
    p.add_argument("--quality", type=int, default=1080, help="最高解析度高度 (預設 1080)")
    p.add_argument("--browser", help="從瀏覽器讀 cookies: chrome / edge / firefox")
    p.add_argument("--playlist", action="store_true", help="網址是播放清單時下載整份")
    p.add_argument("--list", action="store_true", help="只列出格式，不下載")
    args = p.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    with yt_dlp.YoutubeDL(build_opts(args)) as ydl:
        return ydl.download(args.urls)


if __name__ == "__main__":
    sys.exit(main())
