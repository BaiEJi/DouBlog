#!/bin/bash
# 查看后端服务状态

PORT=60100

echo "=== Backend Status ==="
if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -t -i:$PORT 2>/dev/null | head -1)
elif command -v ss >/dev/null 2>&1; then
    PID=$(ss -tlnp 2>/dev/null | grep ":$PORT" | grep -i LISTEN | grep -oP '(?<=pid=)[0-9]+' | head -1)
else
    PID=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTEN | awk '{print $NF}' | head -1)
fi

if [ -n "$PID" ]; then
    echo "Running (PID: $PID, Port: $PORT)"
    ps -p $PID -o %cpu,%mem,etime --no-headers 2>/dev/null || true
else
    echo "Stopped"
fi
