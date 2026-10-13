"""Clash 代理管理能力包：Web 管理迁移层——底层能力完全复用本机 clashctl（bash 函数集）。

对外契约：仅 router——无表、无后台线程（不需要 start_background / ensure_migrations）。
安装检测：DOUBLOG_CLASHCTL_DIR（默认 ~/clashctl）下存在 scripts/cmd/clashctl.sh 即可用。
"""
from .routes import router

__all__ = ['router']
