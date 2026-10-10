"""订阅管理能力（CrownFlow 迁移）：会员 / 订阅记录 / 分类 / 支出统计 / 到期提醒 / 备份。"""
from .routes import router, start_daily_loop


def start_background(app):
    """main.py 后台线程钩子：每日 02:00 备份 + 10:00 支出摘要（app.state.testing 时空转）。"""
    start_daily_loop(app)
