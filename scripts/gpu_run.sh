#!/usr/bin/env bash
# 在共用 GPU 上「搶佔 → 釋放 → 立刻執行」一條龍。
# 用法: scripts/gpu_run.sh [-m MIN_FREE_MIB] [-t TIMEOUT_SEC] [-p PYTHON] <my_code.py> [args...]
#       scripts/gpu_run.sh [選項] -- <任意指令...>      （非 python 任務用）
# 例:   scripts/gpu_run.sh my_code.py --epochs 10
# 預設 python = ~/因子挖掘/.venv/bin/python（該 venv 才有 torch），可用 GPU_PY 或 -p 覆蓋。
#
# 流程:
#   1. nvidia-smi 顯存剩餘 >= MIN_FREE_MIB（預設 20000）→ 直接執行指令。
#   2. 否則啟動 gpu_grab.py 輪詢並持續佔位；累積佔到 >= MIN_FREE 後立刻 kill，緊接著 exec 指令。
#      若指令啟動後仍 OOM 被別人搶走，可重跑本腳本（會再次輪詢）。
set -u

MIN_FREE=${MIN_FREE:-20000}
TIMEOUT=0
PY=${GPU_PY:-$HOME/因子挖掘/.venv/bin/python}
while getopts "m:t:p:" o; do
  case $o in
    m) MIN_FREE=$OPTARG ;;
    t) TIMEOUT=$OPTARG ;;
    p) PY=$OPTARG ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[ "${1:-}" = "--" ] && shift
[ $# -eq 0 ] && { echo "用法: $0 [-m MiB] [-t sec] [-p python] <script.py> [args...]" >&2; exit 2; }
# 第一個參數是 .py → 自動用 venv python 執行
case "$1" in *.py) set -- "$PY" "$@" ;; esac

DIR=$(cd "$(dirname "$0")" && pwd)
free_mib() { nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -n1 | tr -d ' '; }

FREE=$(free_mib)
if [ "${FREE:-0}" -ge "$MIN_FREE" ]; then
  echo "[gpu_run] GPU 空閒 ${FREE} MiB，直接執行" >&2
  exec "$@"
fi

echo "[gpu_run] GPU 剩餘 ${FREE} MiB < ${MIN_FREE}，啟動搶佔..." >&2
nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader >&2

LOG=$(mktemp)
"$PY" "$DIR/gpu_grab.py" >"$LOG" 2>&1 &
GRAB=$!
trap 'kill -9 $GRAB 2>/dev/null; rm -f "$LOG"' EXIT INT TERM

START=$(date +%s)
locked_mib() { grep '^LOCKED' "$LOG" 2>/dev/null | tail -n1 | sed -n 's/.*locked=\([0-9]*\)MiB.*/\1/p'; }
# 佔位累積量（含他人陸續釋放的）達到 MIN_FREE 才算成功
while :; do
  LK=$(locked_mib); LK=${LK:-0}
  [ "$LK" -ge "$MIN_FREE" ] && break
  if ! kill -0 $GRAB 2>/dev/null; then
    echo "[gpu_run] gpu_grab.py 異常結束（是否缺 torch？用 -p 指定有 torch 的 python）:" >&2
    cat "$LOG" >&2; exit 1
  fi
  if [ "$TIMEOUT" -gt 0 ] && [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ]; then
    echo "[gpu_run] 等待逾時 ${TIMEOUT}s" >&2; exit 1
  fi
  sleep 0.2
done

# 搶到了：立刻釋放並接著執行（trap 之後不再需要）
kill -9 $GRAB 2>/dev/null
trap - EXIT INT TERM
rm -f "$LOG"
echo "[gpu_run] 已搶到並釋放，立即執行: $*" >&2
exec "$@"
