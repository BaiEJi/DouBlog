"""进程内 GET 响应缓存：按游戏细粒度写失效 + 纪元防竞态（单进程部署，Doublog 默认形态）。

自 gamemap backend/app/response_cache.py 照搬；适配：源版经 HTTP 中间件在写请求
执行前按路径失效；Doublog 模块无法注册中间件，改由各写端点在 commit 后显式调用
invalidate_game/invalidate_all，失效粒度与源一致（路径版接口随中间件一并舍弃）。
缓存的正文是信封化(api_response 同构)后的 JSON 字节。

- key 均含 game_id（board:{gid}:{cid} / merged:{gid}:... / chars:{gid}:{q} / stats:{gid}）；
- 写 /api/gamemap/games/{gid}/... 只失效该游戏；无法归属游戏的写
  （uploads、events 按 chapter 路由、relation-types 管理端）全失效；
- 纪元 = (全局代, 游戏代)：读时捕获，回填时一致才入缓存，写事务期间的旧读不会污染新纪元。
"""
import threading

_lock = threading.Lock()
_state: dict = {"all_epoch": 0, "game_epochs": {}, "cache": {}}
MAX_ENTRIES = 256


def epoch_for(game_id: int) -> tuple[int, int]:
    with _lock:
        return (_state["all_epoch"], _state["game_epochs"].get(game_id, 0))


def invalidate_game(game_id: int) -> None:
    with _lock:
        _state["game_epochs"][game_id] = _state["game_epochs"].get(game_id, 0) + 1
        prefix1, prefix2 = f":{game_id}:", f":{game_id}"
        _state["cache"] = {k: v for k, v in _state["cache"].items()
                           if not (prefix1 in k or k.endswith(prefix2))}


def invalidate_all() -> None:
    with _lock:
        _state["all_epoch"] += 1
        _state["game_epochs"].clear()
        _state["cache"].clear()


def cache_get(key: str, read_epoch: tuple[int, int]):
    with _lock:
        entry = _state["cache"].get(key)
        if entry is not None and entry[0] == read_epoch:
            return entry[1]
        return None


def cache_put(key: str, read_epoch: tuple[int, int], body: bytes) -> None:
    with _lock:
        if len(_state["cache"]) >= MAX_ENTRIES:
            _state["cache"].clear()
        _state["cache"][key] = (read_epoch, body)
