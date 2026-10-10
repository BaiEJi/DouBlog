"""bench 实例启动器（独立端口 60110 + 独立数据目录）。

用法（Flask 基线期）：
    BENCH_IMPL=flask venv/Scripts/python.exe tools/bench/launch.py
FastAPI 迁移后：
    BENCH_IMPL=fastapi venv/Scripts/python.exe tools/bench/launch.py

环境变量：
    BENCH_IMPL    flask | fastapi
    BENCH_PORT    默认 60110
    BENCH_DATA    默认 <本目录>/data
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(os.path.dirname(HERE))          # backend/
sys.path.insert(0, BACKEND)

PORT = int(os.environ.get('BENCH_PORT', '60110'))
DATA = os.environ.get('BENCH_DATA', os.path.join(HERE, 'data'))
IMPL = os.environ.get('BENCH_IMPL', 'flask')

os.environ['DOUBLOG_LOG_SEND'] = '0'   # bench 不自摄日志，避免噪声
os.makedirs(DATA, exist_ok=True)

from app.config import settings  # noqa: E402

settings.data_dir = DATA
settings.images_dir = os.path.join(DATA, 'images')
settings.debug = False


def run_flask():
    from app.main import create_app
    app = create_app()
    app.config['TESTING'] = False
    app.run(host='127.0.0.1', port=PORT, debug=False, threaded=True, use_reloader=False)


def run_fastapi():
    import uvicorn
    from app.main import create_app
    app = create_app()
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning', access_log=False)


if __name__ == '__main__':
    print(f'bench instance [{IMPL}] on {PORT}, data={DATA}', flush=True)
    if IMPL == 'flask':
        run_flask()
    else:
        run_fastapi()
