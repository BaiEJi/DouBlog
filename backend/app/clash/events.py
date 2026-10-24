"""Authenticated SSE bridge: probe native mihomo WebSocket, fall back to bounded REST polling."""
import asyncio
import threading

import orjson
from fastapi import Request
from fastapi.responses import StreamingResponse
from lizysdk.errors import ServiceUnavailableError

from app.clash import controller, service
from app.shared.pools import run_blocking


def _event(kind, value):
    return f'event: {kind}\ndata: {orjson.dumps(value).decode()}\n\n'


def connection_events(request: Request):
    service.ensure_available()
    state = request.app.state
    if not hasattr(state, 'clash_stream_slots'):
        state.clash_stream_slots = threading.BoundedSemaphore(8)
        state.clash_stream_stop = threading.Event()
    if not state.clash_stream_slots.acquire(blocking=False):
        raise ServiceUnavailableError(message='实时连接数已达上限，请使用手动刷新')
    stop = state.clash_stream_stop

    async def generate():
        try:
            try:
                from websockets.asyncio.client import connect
                base, secret, _ = await run_blocking('clash-stream', controller._controller_info)
                async with connect(base.replace('http://', 'ws://', 1) + '/connections?interval=2000',
                    additional_headers={'Authorization': f'Bearer {secret}'}, proxy=None,
                    compression=None, open_timeout=3, close_timeout=1,
                    max_size=8 * 1024 * 1024, max_queue=2) as websocket:
                    first = True
                    while not stop.is_set() and not await request.is_disconnected():
                        raw = await asyncio.wait_for(websocket.recv(), timeout=5)
                        payload = orjson.loads(raw)
                        if not isinstance(payload, dict) or not isinstance(payload.get('connections', []), list):
                            raise ValueError('invalid connections snapshot')
                        if first:
                            yield _event('mode', {'mode': 'websocket'})
                            first = False
                        yield _event('connections', controller.shape_connections(payload))
                    return
            except asyncio.CancelledError:
                raise
            except Exception:
                # Capability is established by a successful native handshake + frame, never guessed by version.
                yield _event('mode', {'mode': 'polling'})
            while not stop.is_set() and not await request.is_disconnected():
                try:
                    payload = await run_blocking('clash-stream', controller.connections_get, workers=8)
                    yield _event('connections', payload)
                except Exception:
                    yield _event('status', {'available': False})
                for _ in range(20):
                    if stop.is_set() or await request.is_disconnected():
                        return
                    await asyncio.sleep(0.1)
        finally:
            state.clash_stream_slots.release()

    return StreamingResponse(generate(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no',
    })


def stop_background(app, timeout=5.0):
    stop = getattr(app.state, 'clash_stream_stop', None)
    if stop:
        stop.set()
    return True


def start_background(app):
    stop = getattr(app.state, 'clash_stream_stop', None)
    if stop and stop.is_set():
        app.state.clash_stream_stop = threading.Event()
