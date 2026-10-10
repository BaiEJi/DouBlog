"""GET /api/todo/today 响应缓存(信封字节级,同 gamemap response_cache 思路)。

- /today 是主读聚合(四象限+待迁移+昨日+streak),单请求 8 条查询 + 76 任务级
  序列化;同一看板被反复打开时结果完全相同——缓存信封字节后命中路径只剩
  gzip + 传输。
- 失效:全局写纪元。todo 模块所有写端点 commit 后 bump();任何写都令全部
  缓存立即失效(跨 app 过度失效是正确方向,只多不少)。
- 隔离:缓存体挂在 app.state.todo_today_cache(禁模块级单例,多 app 测试互不
  串数据);键含 (view_date, 本地今日)——跨午夜自动换键,无需 TTL。
- 直接改库不经 API 的写入不在失效范围(单进程应用约定,同 gamemap 缓存)。
"""
from __future__ import annotations

import threading

_lock = threading.Lock()
_epoch = 0
MAX_ENTRIES = 64


def bump() -> None:
    """todo 表发生写入后调用:令全部 /today 缓存失效。"""
    global _epoch
    with _lock:
        _epoch += 1


def epoch() -> int:
    with _lock:
        return _epoch


def get(state: dict, key) -> bytes | None:
    """读缓存(state = app.state.todo_today_cache);纪元不一致视为未命中。"""
    entry = state.get(key)
    if entry is not None and entry[0] == epoch():
        return entry[1]
    return None


def put(state: dict, key, body: bytes) -> None:
    if len(state) >= MAX_ENTRIES:
        state.clear()
    state[key] = (epoch(), body)
