#!/bin/bash
# 启动后端服务（端口 60100）

PORT=60100
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/backend"

port_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -t -i:$PORT 2>/dev/null | head -1
    else
        netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTEN | awk '{print $NF}' | head -1
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

sleep 2
if [ -n "$(port_pid)" ]; then
    echo "Backend started on http://0.0.0.0:$PORT (log: backend/logs/flask.log)"
else
    echo "Failed to start backend"
    exit 1
fi
