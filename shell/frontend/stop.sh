#!/bin/bash
# 停止前端服务

PORT=60101

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

PID=$(port_pid)
if [ -z "$PID" ]; then
    echo "Frontend not running"
    exit 0
fi

kill $PID 2>/dev/null
sleep 1

if [ -n "$(port_pid)" ]; then
    kill -9 $PID 2>/dev/null
fi

echo "Frontend stopped"
