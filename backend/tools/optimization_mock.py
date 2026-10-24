"""Loopback-only APIHub and mihomo fixture. No forwarding or system changes."""
from fastapi import FastAPI
import uvicorn

app = FastAPI()


@app.get('/echo')
@app.post('/echo')
async def echo():
    return {'ok': True, 'fixture': 'local-only'}


@app.get('/connections')
async def connections():
    return {'uploadTotal': 10000, 'downloadTotal': 20000, 'connections': [
        {'id': f'fixture-{i}', 'metadata': {'network': 'tcp', 'type': 'HTTP',
          'sourceIP': '127.0.0.1', 'sourcePort': '1234', 'destinationIP': '127.0.0.1',
          'destinationPort': '80', 'host': f'local-{i}.invalid', 'processPath': 'fixture'},
         'upload': i * 10, 'download': i * 20, 'chains': ['DIRECT'], 'rule': 'Match',
         'rulePayload': '', 'start': '2026-10-21T00:00:00Z'} for i in range(300)]}


@app.get('/configs')
async def configs():
    return {'mode': 'rule', 'allow-lan': False, 'log-level': 'info', 'mixed-port': 7890}


@app.get('/version')
async def version():
    return {'version': 'local-fixture', 'meta': True}


@app.get('/proxies')
async def proxies():
    return {'proxies': {'DIRECT': {'name': 'DIRECT', 'type': 'Direct', 'alive': True,
                                  'history': []}}}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=60115, log_level='warning', access_log=False)
