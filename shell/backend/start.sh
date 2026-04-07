#!/bin/bash

PROJECT_DIR="/home/lizy/projects/DouBlog/backend"
PORT=60100

if netstat -tlnp 2>/dev/null | grep -q ":$PORT " || ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "Backend already running on port $PORT"
    exit 0
fi

cd "$PROJECT_DIR"
nohup python run.py > flask.log 2>&1 &
disown

sleep 2
if netstat -tlnp 2>/dev/null | grep -q ":$PORT " || ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "Backend started on http://0.0.0.0:$PORT"
else
    echo "Failed to start backend"
    exit 1
fi
