"""Run the real application against an isolated SQLite database for browser tests.

No route mocks, production data, external services, or background jobs are used.
"""
import argparse
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=60113)
parser.add_argument('--data-dir', required=True)
args = parser.parse_args()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DOUBLOG_TESTING'] = '1'
os.environ['DOUBLOG_LOG_SEND'] = '0'
from app.config import settings

settings.database_backend = 'sqlite'
settings.data_dir = str(Path(args.data_dir).resolve())
settings.images_dir = str(Path(settings.data_dir) / 'images')
settings.auth_username = os.environ.get('MINDMAP_QA_USERNAME', 'mindmap-qa')
settings.auth_password = os.environ.get('MINDMAP_QA_PASSWORD', 'qa-only-isolated-db')
settings.logs_send_json = False
from app.main import app
import uvicorn

uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
