"""Local-only platform benchmark fixtures, compatible with the saved baseline.

Call seed_platform(app, local_http_url, fixture_directory) after create_app with
DOUBLOG_TESTING=1 and a fresh isolated SQLite database. No real services are used.
The HTTP mock should serve /echo and mihomo /connections, /configs, /version.
"""
import json
import os
import time
from contextlib import nullcontext
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit


def seed_platform(app, upstream_url, data_dir):
    parsed = urlsplit(upstream_url)
    if parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('benchmark upstream must be local')
    import app.db as database
    context = database.database_context(app) if hasattr(database, 'database_context') else nullcontext()
    with context:
        from sqlalchemy import insert
        from app.sdklogs.models import SdkLog
        from app.confcenter.models import ConfEntry, ConfNamespace
        from app.apihub.models import ApihubSystem, ApihubApi, ApihubToken
        from app.apihub.core import hash_token
        from app.steamidler.models import SteamidlerAccount
        db = database.db
        start = datetime(2026, 1, 1)
        db.session.execute(insert(SdkLog), [{
            'ts': start + timedelta(seconds=index % 86400), 'level': 20, 'level_text': 'INFO',
            'sys_name': 'benchmark-platform', 'message': f'fixture {index} 中文',
            'fields': {'index': str(index)}, 'received_at': start,
        } for index in range(25000)])
        db.session.add(ConfNamespace(namespace='benchmark'))
        db.session.execute(insert(ConfEntry), [{
            'namespace': 'benchmark', 'key': f'key-{index:05}', 'type': 'json',
            'data': json.dumps({'index': index, 'data': 'x' * 120}), 'updated_at': start,
        } for index in range(5000)])
        system = ApihubSystem(name='Local benchmark', slug='benchmark-platform', base_url=upstream_url,
                               timeout_ms=2000, max_retry=0, transport={}, status=1)
        db.session.add(system)
        db.session.flush()
        api = ApihubApi(name='Local echo', slug='benchmark-platform', system_id=system.id,
                        method='GET', path_tpl='/echo', auth_config={
                            'providers': [{'type': 'path_token'}], 'credential_fields': [], 'credential': {}},
                        request_cfg={}, response_cfg={'envelope': 'wrap'}, enabled=True)
        db.session.add(api)
        token = 'sk-benchmark-local-only-platform'
        db.session.add(ApihubToken(name='benchmark', key_hash=hash_token(token), key_hint='local-only', status=1))
        # Repeated account polling must avoid fetching these large token/game fields.
        cache = json.dumps([{'appid': index + 1, 'name': 'game-' + str(index)} for index in range(5000)])
        db.session.execute(insert(SteamidlerAccount), [{
            'steamid': str(76561198000000000 + index), 'account_name': f'fixture-{index}',
            'refresh_token': 'fixture-not-a-token', 'shared_secret': '', 'idle_appids': '[]',
            'auto_resume': False, 'farmed_seconds': 0, 'games_cache': cache,
            'games_cached_at': time.time() + 7 * 86400, 'created_at': index, 'updated_at': 0,
        } for index in range(100)])
        db.session.commit()
        state = getattr(app.state, 'apihub', None)
        if state is not None:
            state.reload()

    fixture = Path(data_dir).resolve() / 'clashctl'
    (fixture / 'scripts' / 'cmd').mkdir(parents=True, exist_ok=True)
    (fixture / 'resources').mkdir(exist_ok=True)
    (fixture / 'scripts' / 'cmd' / 'clashctl.sh').write_text('# local fixture\n', encoding='utf-8')
    (fixture / '.env').write_text('KERNEL_NAME=mihomo\n', encoding='utf-8')
    runtime = (f'external-controller: "127.0.0.1:{parsed.port}"\nsecret: "benchmark-controller"\n'
               'log-level: info\nproxies:\n' + ''.join(
                   f'  - {{name: "fixture-{index}", type: direct}}\n' for index in range(2000)))
    (fixture / 'resources' / 'runtime.yaml').write_text(runtime, encoding='utf-8')
    os.environ['DOUBLOG_CLASHCTL_DIR'] = str(fixture)
    return {
        'token': token,
        'endpoints': {
            'logs_search': '/api/v1/logs?sys_name=benchmark-platform&limit=100',
            'logs_histogram': '/api/v1/logs/histogram?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z&buckets=60',
            'conf_get': '/api/confcenter/benchmark/key-02500',
            'conf_list': '/api/confcenter/entries?namespace=benchmark&page_size=50',
            'steam_snapshot': '/api/steamidler/accounts',
            'clash_connections': '/api/clash/controller/connections',
            'apihub_invoke': '/api/apihub/gw/apis/benchmark-platform',
        },
        'counts': {'logs': 25000, 'conf': 5000, 'steam': 100, 'clash_proxies': 2000},
    }
