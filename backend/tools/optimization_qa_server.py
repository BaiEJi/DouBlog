"""Isolated real application used by browser QA and reproducible A/B benches.

Select source before importing app; use the identical fixture module for both
revisions. Never reads a production data directory or launches external jobs.
"""
import argparse
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=60113)
parser.add_argument('--data-dir', required=True)
parser.add_argument('--source', default=str(Path(__file__).resolve().parents[1]))
parser.add_argument('--seed', action='store_true')
parser.add_argument('--large', action='store_true')
parser.add_argument('--quiet', action='store_true')
parser.add_argument('--bench-extra', action='store_true')
args = parser.parse_args()
test_root = Path(__file__).resolve().parents[2] / '.ui-qa'
if not Path(args.data_dir).resolve().is_relative_to(test_root):
    raise ValueError('QA database must be inside this repository .ui-qa directory')
sys.path.insert(0, str(Path(args.source).resolve()))
sys.path.insert(1, str(Path(__file__).resolve().parent))
os.environ['DOUBLOG_TESTING'] = '1'
os.environ['DOUBLOG_LOG_SEND'] = '0'

# Tool-only guard: browser routing cannot prevent a server-side SDK/network call.
# Fail before standard-library DNS or TCP for non-loopback destinations.
# Steam's gevent transport is separately disabled below.
import socket
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex
_getaddrinfo = socket.getaddrinfo
def _local_host(host):
    return host in ('127.0.0.1', 'localhost', '::1', b'127.0.0.1', b'localhost', b'::1', None)
def _guarded_connect(sock, address):
    if isinstance(address, tuple) and not _local_host(address[0]):
        raise OSError('Isolated QA blocks non-loopback connections')
    return _connect(sock, address)
def _guarded_connect_ex(sock, address):
    if isinstance(address, tuple) and not _local_host(address[0]):
        raise OSError('Isolated QA blocks non-loopback connections')
    return _connect_ex(sock, address)
def _guarded_getaddrinfo(host, *args, **kwargs):
    if not _local_host(host):
        raise OSError('Isolated QA blocks non-loopback DNS')
    return _getaddrinfo(host, *args, **kwargs)
socket.socket.connect = _guarded_connect
socket.socket.connect_ex = _guarded_connect_ex
socket.getaddrinfo = _guarded_getaddrinfo
from app.config import settings

settings.database_backend = 'sqlite'
settings.data_dir = str(Path(args.data_dir).resolve())
settings.images_dir = str(Path(settings.data_dir) / 'images')
settings.auth_username = 'mindmap-qa'
settings.auth_password = 'qa-only-isolated-db'
settings.debug = False
settings.logs_send_json = False
# Restore this even when an existing seed manifest skips seed_platform().
# An absent fixture must never fall through to the user's real Clash directory.
os.environ['DOUBLOG_CLASHCTL_DIR'] = str(Path(settings.data_dir) / 'clashctl')
from app.main import app

# Native/gevent transports can retain their own socket implementations. QA uses
# only saved fake accounts; never start a Steam connection or a real login.
from app.steamidler.worker import AccountWorker
from app.steamidler.auth import LoginAttempt

def _disabled_steam_connection(*args, **kwargs):
    raise RuntimeError('Steam connections are disabled in isolated QA')

AccountWorker.start = _disabled_steam_connection
LoginAttempt.begin = _disabled_steam_connection


def seed_benchmark_extras(engine):
    """Opaque ciphertext only; these fixtures are never used for UI unlock QA."""
    import base64
    import hashlib
    from datetime import datetime, timedelta
    from sqlalchemy.orm import Session
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from app.vault.models import VaultItem
    from app.pwsvc.models import PwsvcProject
    from app.system.models import SystemHomeGroup, SystemHomeCard
    cipher = AESGCM(b'\x01' * 32)
    with Session(engine) as session:
        for i in range(1000):
            nonce = i.to_bytes(12, 'big')
            plain = json.dumps({'name': f'item-{i:04}', 'password': 'fixture-only',
                                'notes': 'test fixture ' * 50}).encode()
            blob = {'n': base64.b64encode(nonce).decode(),
                    'ct': base64.b64encode(cipher.encrypt(nonce, plain, None)).decode()}
            stamp = datetime(2026, 10, 21) + timedelta(seconds=i)
            session.add(VaultItem(blob=json.dumps(blob), created_at=stamp, updated_at=stamp))
        for i in range(12):
            stamp = datetime(2026, 10, 21) + timedelta(seconds=i)
            session.add(PwsvcProject(name=f'fixture-project-{i}', description='local fixture',
                api_key_hash=hashlib.sha256(f'local-project-{i}'.encode()).hexdigest(),
                api_key_prefix='local-only', created_at=stamp, updated_at=stamp))
        for index, name in enumerate(('写作', '工作', '系统')):
            group = SystemHomeGroup(name=name, position=index)
            session.add(group); session.flush()
            for position, key in enumerate(('blog', 'todo', 'config')[index:index + 1]):
                session.add(SystemHomeCard(group_id=group.id, key=key, position=position))
        session.commit()


def seed_graph(engine):
    from sqlalchemy.orm import Session
    from app.gamemap.models import Game, Chapter, Board, BoardNode, Character, ChapterRelation, RelationType
    with Session(engine) as session:
        game = Game(name='优化验收剧情图谱', description='isolated graph fixture')
        session.add(game); session.flush()
        chapter = Chapter(game_id=game.id, title='第一章', order_index=1)
        session.add(chapter); session.flush()
        board = Board(chapter_id=chapter.id)
        session.add(board); session.flush()
        characters = []
        for i in range(30):
            character = Character(game_id=game.id, name=f'人物 {i:03}', faction=f'阵营 {i % 3}')
            session.add(character); session.flush(); characters.append(character)
            session.add(BoardNode(board_id=board.id, character_id=character.id,
                                  x=(i % 6) * 330, y=(i // 6) * 240))
        relation_type = session.query(RelationType).filter(RelationType.game_id.is_(None)).first()
        for i in range(45):
            session.add(ChapterRelation(board_id=board.id,
                from_character_id=characters[i % 30].id,
                to_character_id=characters[(i * 7 + 1 + (i // 30) * 3) % 30].id,
                relation_type_id=relation_type.id, description=f'关系 {i}'))
        session.commit()
        return {'game_id': game.id, 'chapter_id': chapter.id}


manifest_path = Path(settings.data_dir) / 'optimization-fixture.json'
if args.seed and not manifest_path.exists():
    from optimization_knowledge_fixture import seed_knowledge, seed_bookmarks
    manifest = seed_knowledge(app.state.engine, large=args.large)
    manifest.update(seed_bookmarks(app.state.engine, large=args.large))
    manifest.update(seed_graph(app.state.engine))
    if args.bench_extra:
        seed_benchmark_extras(app.state.engine)
        manifest['extra_counts'] = {'vault_items': 1000, 'pwsvc_projects': 12, 'portal_groups': 3}
    platform = Path(__file__).parent / 'platform_fixtures.py'
    if platform.exists():
        from platform_fixtures import seed_platform
        manifest['platform'] = seed_platform(app, upstream_url='http://127.0.0.1:60115',
                                              data_dir=Path(settings.data_dir))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

if args.quiet:
    import logging
    logging.disable(logging.CRITICAL)

import uvicorn
uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning', access_log=False)
