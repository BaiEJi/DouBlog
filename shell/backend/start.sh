#!/bin/bash
# 启动后端服务（端口 60100）

PORT=60100
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/backend"

port_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -t -i:$PORT 2>/dev/null | head -1
    elif command -v ss >/dev/null 2>&1; then
        ss -tlnp 2>/dev/null | grep ":$PORT" | grep -i LISTEN | grep -oP '(?<=pid=)[0-9]+' | head -1
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTEN | awk '{print $NF}' | head -1
    else
        :  # 无可用端口探测工具
    fi
}

if [ -n "$(port_pid)" ]; then
    echo "Backend already running on port $PORT"
    exit 0
fi

cd "$PROJECT_DIR" || exit 1

# 优先使用虚拟环境
if [ -f "venv/Scripts/python.exe" ]; then
    PYTHON="venv/Scripts/python.exe"
elif [ -f "venv/bin/python" ]; then
    PYTHON="venv/bin/python"
else
    PYTHON="python"
fi

mkdir -p logs
nohup "$PYTHON" run.py > logs/flask.log 2>&1 &
disown

# PG 后端冷启动（建连/建表/迁移）可能超过 2s：最长等 20s，每秒探测一次
i=0
while [ $i -lt 20 ]; do
    [ -n "$(port_pid)" ] && break
    sleep 1
    i=$((i+1))
done
if [ -n "$(port_pid)" ]; then
    echo "Backend started on http://0.0.0.0:$PORT (log: backend/logs/flask.log)"
else
    echo "Failed to start backend"
    exit 1
fi
