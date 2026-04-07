#!/bin/bash

PROJECT_DIR="/home/lizy/projects/DouBlog/frontend"
PORT=60101

if netstat -tlnp 2>/dev/null | grep -q ":$PORT " || ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "Frontend already running on port $PORT"
    exit 0
fi

cd "$PROJECT_DIR"
mkdir -p logs
nohup npm run dev > logs/vite.log 2>&1 &
disown

sleep 3
if netstat -tlnp 2>/dev/null | grep -q ":$PORT " || ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "Frontend started on http://0.0.0.0:$PORT"
else
    echo "Failed to start frontend"
    exit 1
fi
