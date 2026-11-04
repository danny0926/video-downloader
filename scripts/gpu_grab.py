"""輪詢 GPU 顯存，一有空間就搶佔（來源：triggerOOM.txt，加上可被 wrapper 偵測的標記）。

成功搶到後會印出一行以 `LOCKED` 開頭的訊息；Ctrl+C 或被 kill 時結束並釋放顯存。
"""
import sys
import time

import torch

device = torch.device("cuda:0")
held = []
i = 0
MIB = 1024 * 1024

print("開始輪詢等待顯存釋放...", flush=True)

while True:
    i += 1
    try:
        free_bytes, _ = torch.cuda.mem_get_info(device)
        if free_bytes > 20 * MIB:
            # 先吃 1 byte 鎖住 CUDA Context，再重新查詢真實剩餘量
            if not held:
                held.append(torch.empty(1, dtype=torch.uint8, device=device))
                free_bytes, _ = torch.cuda.mem_get_info(device)
            target = free_bytes - 16 * MIB  # 留 16 MiB 緩衝
            if target > 0:
                held.append(torch.empty(target, dtype=torch.uint8, device=device))
                locked = torch.cuda.memory_allocated(device) // MIB
                left = torch.cuda.mem_get_info(device)[0] // MIB
                print(f"LOCKED poll={i} locked={locked}MiB left={left}MiB", flush=True)
    except KeyboardInterrupt:
        print("\n已手動停止輪詢。", flush=True)
        sys.exit(0)
    except BaseException:
        pass  # AcceleratorError / OOM 全部吞掉繼續輪詢
    time.sleep(0.05)
