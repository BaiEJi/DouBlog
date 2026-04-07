#!/bin/bash

PORT=60101

echo "=== Frontend Status ==="
PID=$(lsof -t -i:$PORT 2>/dev/null)

if [ -n "$PID" ]; then
    echo "Running (PID: $PID, Port: $PORT)"
    ps -p $PID -o %cpu,%mem,etime --no-headers 2>/dev/null
else
    echo "Stopped"
fi
