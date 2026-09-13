#!/bin/bash
# 停止后端服务

PORT=60100

port_pid() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -t -i:$PORT 2>/dev/null | head -1
    else
        netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTEN | awk '{print $NF}' | head -1
    fi
}

PID=$(port_pid)
if [ -z "$PID" ]; then
    echo "Backend not running"
    exit 0
fi

kill $PID 2>/dev/null
sleep 1

if [ -n "$(port_pid)" ]; then
    kill -9 $PID 2>/dev/null
fi

echo "Backend stopped"
