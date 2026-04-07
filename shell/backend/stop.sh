#!/bin/bash

PORT=60100

PID=$(lsof -t -i:$PORT 2>/dev/null)
if [ -z "$PID" ]; then
    echo "Backend not running"
    exit 0
fi

kill $PID 2>/dev/null
sleep 1

if lsof -t -i:$PORT 2>/dev/null; then
    kill -9 $PID 2>/dev/null
fi

echo "Backend stopped"
