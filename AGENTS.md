# AGENTS.md

## 實驗室 GPU（共用機器）使用規則

要在實驗室 server（`ssh lab`，單張 RTX 4090 24GB，專案目錄 `~/因子挖掘`）跑任何吃 GPU 的任務時，**一律透過 `scripts/gpu_run.sh` 啟動**，不要直接執行。

### 流程（腳本已自動化）

1. `nvidia-smi` 查剩餘顯存；若空閒足夠（預設 ≥ 20000 MiB）→ 直接執行任務。
2. 若 GPU 有人在用 → 自動啟動 `scripts/gpu_grab.py` 輪詢（每 50ms），對方一釋放就把剩餘顯存吃光佔位。
3. 佔位成功（輸出 `LOCKED`）→ **立刻 kill 佔位程序，緊接著 exec 我們要執行的指令**。

### 指令

Server 專案目錄為 `~/因子挖掘`，torch 只在其 venv（`~/因子挖掘/.venv`）裡；`gpu_run.sh` 預設就用該 venv 的 python，**不必另外 activate 或指定 python**。

```bash
# 同步腳本到 server（首次或更新後）
scp scripts/gpu_grab.py scripts/gpu_run.sh lab:~/因子挖掘/scripts/

# 跑 python 任務：直接帶 .py 與參數即可
ssh lab 'cd ~/因子挖掘 && bash scripts/gpu_run.sh my_code.py --epochs 10'

# 非 python 任務用 --
ssh lab 'cd ~/因子挖掘 && bash scripts/gpu_run.sh -- bash run.sh'

# 選項: -m 8000 最低空閒顯存 MiB（預設 20000）; -t 3600 最長等待秒數; -r 100 OOM 最多重試次數（預設 100）; -p 覆蓋 python
```

手動進 server 時等價於：`cd ~/因子挖掘 && source .venv/bin/activate`。

長時間任務用 `nohup` 避免 ssh 斷線：

```bash
ssh lab 'cd ~/因子挖掘 && nohup bash scripts/gpu_run.sh -t 7200 job.py > job.log 2>&1 &'
```

### 注意事項

- 這是共用機器：只在 GPU 被占用且確實需要時才用搶佔，並用 `-m` 設合理的最低顯存，不要無謂霸佔。
- 搶佔腳本需要 torch，因此一律用 `~/因子挖掘/.venv`；不要在其他既有環境裝套件。
- kill 與指令啟動之間有空窗，可能被別人搶走顯存；腳本偵測到任務因 CUDA OOM 失敗會自動重新搶佔並重跑，最多 `-r` 次（預設 100）。
- 手動停止佔位：`ssh lab 'pkill -f gpu_grab.py'`。
- 原始腳本備份：`D:\download\triggerOOM.txt`。
