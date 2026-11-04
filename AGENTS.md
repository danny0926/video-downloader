# AGENTS.md

## 實驗室 GPU（共用機器）使用規則

要在實驗室 server（`ssh lab`，單張 RTX 4090 24GB，工作區 `~/AD`）跑任何吃 GPU 的任務時，**一律透過 `scripts/gpu_run.sh` 啟動**，不要直接執行。

### 流程（腳本已自動化）

1. `nvidia-smi` 查剩餘顯存；若空閒足夠（預設 ≥ 20000 MiB）→ 直接執行任務。
2. 若 GPU 有人在用 → 自動啟動 `scripts/gpu_grab.py` 輪詢（每 50ms），對方一釋放就把剩餘顯存吃光佔位。
3. 佔位成功（輸出 `LOCKED`）→ **立刻 kill 佔位程序，緊接著 exec 我們要執行的指令**。

### 指令

```bash
# 同步腳本到 server（首次或更新後）
scp scripts/gpu_grab.py scripts/gpu_run.sh lab:~/AD/scripts/

# 一條龍執行（-p 指定「有 torch 的」python，系統 python3 沒有 torch）
ssh lab 'cd ~/AD && bash scripts/gpu_run.sh -p ~/V1/venv/bin/python -- ~/V1/venv/bin/python train.py'

# 常用選項
#   -m 8000   需要的最低空閒顯存 MiB（預設 20000）
#   -t 3600   最長等待秒數（預設無限）
```

長時間任務請用 `nohup ... &` 或 `tmux` 包起來，避免 ssh 斷線：

```bash
ssh lab 'cd ~/AD && nohup bash scripts/gpu_run.sh -t 7200 -p ~/V1/venv/bin/python -- ~/V1/venv/bin/python job.py > job.log 2>&1 &'
```

### 注意事項

- 這是共用機器：只在 GPU 被占用且確實需要時才用搶佔，並用 `-m` 設合理的最低顯存，不要無謂霸佔。
- 腳本需要有 torch 的 Python（既有：`~/V1/venv`、`~/V2/venv`、`~/Quant/venv`）；不要在既有環境裝套件，需要時另開獨立 venv。
- kill 與指令啟動之間有極短空窗，若任務啟動即 OOM（被別人搶走），直接重跑同一條 `gpu_run.sh` 指令即可。
- 手動停止佔位：`ssh lab 'pkill -f gpu_grab.py'`。
- 原始腳本備份：`D:\download\triggerOOM.txt`。
