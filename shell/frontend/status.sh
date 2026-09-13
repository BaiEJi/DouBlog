#!/bin/bash
# 查看前端服务状态

PORT=60101

echo "=== Frontend Status ==="
if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -t -i:$PORT 2>/dev/null | head -1)
else
    PID=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTEN | awk '{print $NF}' | head -1)
fi

if [ -n "$PID" ]; then
    echo "Running (PID: $PID, Port: $PORT)"
    ps -p $PID -o %cpu,%mem,etime --no-headers 2>/dev/null || true
else
    echo "Stopped"
fi
