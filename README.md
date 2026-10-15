# 網路影片下載

用 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 加上一個自製的 Chrome 外掛，下載網頁上播放的影片或音訊。
外掛偵測頁面載入的影片，**一個影片一個「下載」鈕**；實際下載與合併由本機的小服務完成，成品直接存到 Windows 的「下載」資料夾。

> 只支援沒有 DRM 的內容。請只下載你有權下載的內容（自己的影片、已授權內容、個人備份）。許多網站的服務條款不允許下載，使用前請自行評估。

---

## 目錄

- [運作方式](#運作方式)
- [專案結構](#專案結構)
- [安裝](#安裝)
- [日常使用](#日常使用)
- [彈出視窗說明](#彈出視窗說明)
- [開機自動啟動（背景、無視窗）](#開機自動啟動背景無視窗)
- [命令列用法](#命令列用法)
- [設定與調整](#設定與調整)
- [本機服務 API](#本機服務-api)
- [安全性](#安全性)
- [疑難排解](#疑難排解)
- [限制](#限制)

---

## 運作方式

```
 Chrome 分頁                       Chrome 外掛 (extension/)              本機服務 (server.py)
┌──────────────┐  播放時載入       ┌──────────────────────┐   POST        ┌─────────────────────┐
│ 影片網頁      │ ───────────────▶ │ 偵測 Vimeo 播放器 /   │ ───────────▶ │ 排隊 (最多同時 2 個)  │
│ (按下播放鍵)  │  iframe / m3u8   │ m3u8 / 單一檔案       │  網址+Referer │ yt-dlp 下載 + ffmpeg │
└──────────────┘                  │ 整理成「一個影片一項」 │ ◀─────────── │ 合併成 mp4           │
                                  └──────────────────────┘   進度/狀態   └──────────┬──────────┘
                                                                                    ▼
                                                                       C:\Users\<你>\Downloads
```

- **要先按播放才偵測得到**：多數網站的播放器是按了播放才載入影片，外掛是監聽瀏覽器實際發出的請求（和市面上的下載外掛原理相同）。
- **為什麼要有本機服務**：現代網站的影片多是「切成很多小片段的串流」(HLS/DASH)，Chrome 本身無法合併。交給 yt-dlp 與 ffmpeg 處理，才能得到單一 mp4。
- **關掉彈出視窗不影響下載**：下載在本機服務裡執行，彈出視窗只是顯示進度。

## 專案結構

```
網路影片下載/
├─ extension/            Chrome 外掛 (Manifest V3)
│  ├─ manifest.json
│  ├─ background.js      偵測影片、整理項目、換頁清除
│  ├─ popup.html / popup.js   彈出視窗：本頁影片 + 下載清單
├─ server.py             本機下載服務 (yt-dlp + 佇列 + 進度)
├─ start_server.bat      手動啟動服務 (會顯示視窗，除錯用)
├─ download.py           命令列下載工具 (不經過外掛)
├─ sniff.py              獨立的「開瀏覽器等你按播放再抓」腳本 (備用方案)
├─ requirements.txt
├─ jobs.json             下載清單紀錄 (自動產生，已加入 .gitignore)
├─ .tmp/                 下載中的暫存檔 (自動產生，完成後清掉)
└─ .venv/                Python 虛擬環境 (自行建立)
```

## 安裝

需求：Windows、Python 3.12、Google Chrome。

### 1. 建立環境

```powershell
cd D:\vscode_python\網路影片下載
python -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\python -m pip install -r requirements.txt
```

`imageio-ffmpeg` 會一併帶一份 ffmpeg，不需要另外安裝。
`playwright` 只有 `sniff.py` 會用到，不用它可以略過。

### 2. 啟動本機服務

先手動試跑（會開一個黑色視窗，關掉就停止）：

```powershell
.venv\Scripts\python server.py
```

或雙擊 `start_server.bat`。要改成開機自動在背景執行，見[開機自動啟動](#開機自動啟動背景無視窗)。

### 3. 安裝 Chrome 外掛

自己載入的外掛**完全免費**（上架 Chrome 線上商店才要一次性 5 美元註冊費，自用不需要）。

1. 網址列輸入 `chrome://extensions`
2. 開啟右上角「**開發人員模式**」
3. 按「**載入未封裝項目**」，選擇本專案的 `extension` 資料夾
4. 點工具列的拼圖圖示，把「Media Sniffer」釘選起來

> 修改過外掛程式後，到 `chrome://extensions` 按該外掛的重新整理圖示即可載入新版。
> Chrome 每次啟動可能提示「停用開發人員模式的外掛」，直接關閉提示即可。

## 日常使用

1. 確認本機服務在執行（已設定開機自動啟動就不用管）。
2. 開啟影片頁面，**按下播放鍵**。
3. 外掛圖示出現綠色數字，表示偵測到影片。點圖示。
4. 在「本頁偵測到的影片」按「**下載**」。
5. 可以關掉彈出視窗、換分頁。下載會在背景繼續；隨時點外掛圖示，在「下載清單」查看進度。
6. 完成後影片在 `C:\Users\<你>\Downloads`（Windows 的「下載」資料夾）。

## 彈出視窗說明

### 本頁偵測到的影片

| 項目 | 說明 |
|---|---|
| Vimeo 影片 | 頁面嵌入了 Vimeo 播放器；整支影片只有一項 |
| 串流影片 | m3u8 / mpd 播放清單。同一支影片有「總清單」與各畫質「子清單」時，只顯示總清單 |
| 影片檔 / 音訊檔 | 單一 mp4 / mp3 等檔案，直接交給 Chrome 下載 |

- 串流項目會標示**影片長度與最高畫質**，例如「串流影片（6:38 · 最高 1080p）：標題」，用來判斷是否為完整影片。
- 換頁、重新整理、單頁式網站切換影片時，這個清單會**重新偵測**（需要再按一次播放）。

### 下載清單

所有分頁共用，重新整理頁面也不會消失；服務重啟後紀錄仍在（`jobs.json`）。

| 狀態 | 意思 |
|---|---|
| 等待中 | 排隊中（同時最多下載 2 個） |
| 下載中 | 顯示百分比與進度條 |
| 已完成 | 顯示檔名；原項目按鈕會變成「重新下載」 |
| 失敗 | 顯示原因；服務被關掉時中斷的任務也會標成失敗 |

右上角按鈕：**開啟資料夾**（打開下載資料夾）、**清除已完成**（只清紀錄，不刪影片檔）。
同一個影片已在排隊或下載中時，再按下載不會重複建立。

## 開機自動啟動（背景、無視窗）

在 Windows「啟動」資料夾放一個捷徑，用 `pythonw.exe`（不開視窗的 Python）執行 `server.py`。PowerShell：

```powershell
$root = "D:\vscode_python\網路影片下載"
$ws   = New-Object -ComObject WScript.Shell
$lnk  = $ws.CreateShortcut([Environment]::GetFolderPath("Startup") + "\MediaSnifferServer.lnk")
$lnk.TargetPath       = "$root\.venv\Scripts\pythonw.exe"
$lnk.Arguments        = "`"$root\server.py`""
$lnk.WorkingDirectory = $root
$lnk.WindowStyle      = 7
$lnk.Save()
```

立刻啟動一份（不用等開機）：

```powershell
Start-Process "$root\.venv\Scripts\pythonw.exe" -ArgumentList "`"$root\server.py`"" -WorkingDirectory $root -WindowStyle Hidden
```

- **停止服務**：工作管理員結束 `pythonw` 行程（會看到兩個，一個是 venv 啟動器，一個是實際程式，屬正常）。
- **取消自動啟動**：刪除 `shell:startup` 資料夾（檔案總管網址列輸入 `shell:startup`）裡的 `MediaSnifferServer.lnk`。
- **修改 `server.py` 後**需重啟服務才會生效。若還有任務在下載，重啟會中斷它們，請等做完。
- 背景模式沒有視窗可看錯誤；失敗原因會顯示在下載清單。要看詳細輸出，先停掉背景服務，改用 `start_server.bat`。

## 命令列用法

不經過外掛、直接給網址下載：

```powershell
.venv\Scripts\python download.py URL                  # 最高 1080p，輸出 mp4
.venv\Scripts\python download.py URL --quality 720    # 限制解析度
.venv\Scripts\python download.py URL --audio          # 只抓音訊，轉 mp3
.venv\Scripts\python download.py URL --playlist       # 整份播放清單
.venv\Scripts\python download.py URL --list           # 只列出可用格式
.venv\Scripts\python download.py URL --browser edge   # 借用瀏覽器登入狀態
```

`download.py` 的成品存到專案內的 `downloads/` 資料夾。

### 備用方案：sniff.py

開一個專用的 Chrome 視窗（登入狀態存在 `.profile/`），等你按下播放，自動抓取並下載媒體請求：

```powershell
.venv\Scripts\python sniff.py "https://example.com/video-page"
```

適合想在外掛之外做偵測除錯，或外掛偵測不到時使用。

## 設定與調整

都在 `server.py` 最上方 / `run_job` 內：

| 想調整 | 修改位置 |
|---|---|
| 同時下載數量（預設 2） | `MAX_PARALLEL = 2` |
| 本機服務埠號（預設 18765） | `PORT`，**同時**要改 `extension/popup.js` 的 `SERVER` |
| 畫質（預設不設上限，永遠選最高） | `run_job` 內的 `"format"`，例如 `"bv*[height<=1080]+ba/b[height<=1080]/b"` 限制 1080p |
| 輸出資料夾（預設 Windows「下載」） | `OUT_DIR = windows_downloads_dir()` |
| 輸出格式（預設 mp4） | `"merge_output_format"` |

> 畫質上限取決於網站提供什麼。影片只有 720p 就只能下載 720p；4K 檔案會很大。
> 埠號 8765 落在 Windows 保留的連接埠範圍（`netsh interface ipv4 show excludedportrange protocol=tcp` 可查），會綁定失敗，所以改用 18765。

## 本機服務 API

服務只在 `127.0.0.1:18765`，**所有請求都要帶 header `X-Media-Sniffer: 1`**，否則回 403。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/` | 健康檢查，回 `{"ok": true}` |
| GET | `/jobs` | 所有任務：`{id: {title, url, state, percent, file, error, created}}` |
| POST | `/download` | body `{"url", "referer", "title"}`，回 `{"id"}`；同網址排隊/下載中則回既有 id |
| POST | `/open` | 開啟下載資料夾 |
| POST | `/clear` | 清除已完成與失敗的紀錄 |

`state` 為 `queued` / `downloading` / `done` / `error`。

## 安全性

- 服務只綁定本機（`127.0.0.1`），區域網路的其他電腦連不到。
- 要求自訂 header `X-Media-Sniffer`。其他網頁用 JavaScript 對本機發跨站請求時，瀏覽器會先做 CORS 預檢，而服務不允許，所以**惡意網頁無法偷偷叫你的電腦下載東西**。
- 只接受 `http` / `https` 網址。
- 外掛使用 `<all_urls>` 與 `webRequest` 權限，才能看到各網站載入的媒體請求；它只把資料存在瀏覽器的 session 儲存區，不會傳到外部。
- `.profile/`（`sniff.py` 的登入資料）、`jobs.json`、`.tmp/` 已列入 `.gitignore`，不會被推上 GitHub。

## 疑難排解

| 現象 | 原因與處理 |
|---|---|
| 彈出視窗說「找不到本機下載服務」 | 服務沒在跑。雙擊 `start_server.bat`，或確認開機自動啟動設定正確 |
| 外掛沒有綠色數字 / 沒偵測到 | 先在頁面**按下播放鍵**；換頁後需要重新播放 |
| 啟動服務出現 `WinError 10013` | 埠號被 Windows 保留或被佔用，換一個埠號（見[設定與調整](#設定與調整)） |
| 下載失敗：`Unsupported URL` 或要求登入 | 該網站需要登入或有網域限制；可試 `download.py --browser edge`，或回報錯誤訊息 |
| 下載失敗：`DRM protected` | 內容有 DRM 保護，無法下載 |
| 下載失敗：`HTTP Error 403/404` | 網址已過期（串流網址常帶有時效），回到頁面重新播放後再按下載 |
| `--browser chrome` 讀不到 cookie | Chrome 開著時鎖住 cookie 資料庫，且新版 Chrome 另有加密；改用 Edge/Firefox，或用外掛流程 |
| 突然全部下載失敗 | 網站更新了：`.venv\Scripts\python -m pip install -U yt-dlp`，再重啟服務 |
| 清單出現好幾個項目 | 彈出視窗的項目會標示長度與畫質，用它判斷哪個是完整影片 |
| 改了 `server.py` 沒反應 | 需重啟服務（結束 `pythonw` 行程後重新啟動） |

## 限制

- 不支援 DRM 內容（例如 Netflix、Disney+ 等）。
- 偵測靠「播放後瀏覽器載入的請求」，所以必須先播放。
- 站方若把串流加密分片或使用特殊協定，可能抓不到完整影片。
- 外掛為自行載入的開發版，Chrome 更新後偶爾需要重新載入。
- 目前以 Windows 為前提（「下載」資料夾查詢、`os.startfile`、`pythonw.exe` 開機啟動）。

## 致謝

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)：下載核心
- [FFmpeg](https://ffmpeg.org/)（經由 [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)）：影音合併
- [Playwright](https://playwright.dev/python/)：`sniff.py` 的瀏覽器控制
