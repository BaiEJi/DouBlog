#!/bin/bash
# 启动前端服务（端口 60101）
#
# 用法:
#   ./start.sh          生产模式: npm run build + vite preview（压缩产物 + 静态服务）
#   ./start.sh dev      开发模式: vite dev server（热更新，不压缩）
#
# 注意: 生产模式启动前请确保后端(60100)已就绪。

PORT=60101
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/frontend"
MODE="${1:-prod}"

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
    echo "Frontend already running on port $PORT"
    exit 0
fi

cd "$PROJECT_DIR" || exit 1
mkdir -p logs

if [ "$MODE" = "dev" ]; then
    echo "Starting frontend (dev mode)..."
    nohup npm run dev > logs/vite.log 2>&1 &
    disown
else
    echo "Building frontend..."
    npm run build > logs/build.log 2>&1
    if [ $? -ne 0 ]; then
        echo "Build failed, see logs/build.log"
        exit 1
    fi
    nohup npx vite preview --host 0.0.0.0 --port $PORT > logs/preview.log 2>&1 &
    disown
fi

sleep 2
if [ -n "$(port_pid)" ]; then
    echo "Frontend started on http://0.0.0.0:$PORT ($MODE mode)"
else
    echo "Failed to start frontend"
    exit 1
fi
