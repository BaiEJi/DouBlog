"""apihub 自注册脚本（tools/apihub_register_self.py）的纯函数测试。

覆盖：路由枚举完整性（排除 apihub 自身）、slug 合法性与唯一性、
路径参数 → apihub 模板转换、按方法分级的限流参数。
"""
import importlib.util
import re
from pathlib import Path


def _load_tool():
    path = Path(__file__).resolve().parents[1] / 'tools' / 'apihub_register_self.py'
    spec = importlib.util.spec_from_file_location('apihub_register_self', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_tool = _load_tool()


def _expected_raw(app):
    """独立重算的期望清单（与脚本实现交叉验证；含路由树展平）"""
    def walk(routes):
        for r in routes:
            sub = getattr(r, 'original_router', None)
            if sub is not None:
                yield from walk(sub.routes)
            else:
                yield r
    out = []
    for r in walk(app.routes):
        p = getattr(r, 'path', '')
        ms = (getattr(r, 'methods', None) or set()) & {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}
        if p.startswith('/api/') and not p.startswith('/api/apihub/'):
            for m in sorted(ms):
                out.append((m, p))
    return out


def test_enumerate_covers_all_module_routes(app):
    items = _tool.enumerate_routes(app)
    expected = _expected_raw(app)
    got = {(i['method'], i['path']) for i in items}
    assert got == set(expected)
    assert len(items) == len(got)          # 无重复


def test_enumerate_excludes_apihub_and_non_api(app):
    items = _tool.enumerate_routes(app)
    for i in items:
        assert i['path'].startswith('/api/')
        assert not i['path'].startswith('/api/apihub/')


def test_slugs_valid_and_unique(app):
    items = _tool.enumerate_routes(app)
    slugs = [i['slug'] for i in items]
    assert len(slugs) == len(set(slugs))
    for s in slugs:
        assert re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', s), s
    # 超长路径截断后必须仍唯一（哈希后缀防撞）
    longs = [i for i in items if len(i['module'] + i['method'] + i['path']) > 70]
    assert longs, '应存在超长路径用例'
    assert len({i['slug'] for i in longs}) == len(longs)


def test_path_param_becomes_hub_template(app):
    items = _tool.enumerate_routes(app)
    by_path = {(i['method'], i['path']): i for i in items}
    assert ('GET', '/api/posts/id/{post_id}') in by_path
    assert by_path[('GET', '/api/posts/id/{post_id}')]['path_tpl'] == '/api/posts/id/{path.post_id}'
    assert ('GET', '/api/gamemap/games/{game_id}/characters/{character_id}/photos') in by_path
    tpl = by_path[('GET', '/api/gamemap/games/{game_id}/characters/{character_id}/photos')]['path_tpl']
    assert tpl == '/api/gamemap/games/{path.game_id}/characters/{path.character_id}/photos'
    # {slug:path} 转换器后缀剥掉，模板仍是合法变量引用
    assert by_path[('GET', '/api/posts/path/{slug:path}')]['path_tpl'] == '/api/posts/path/{path.slug}'


def test_rule_tiering_by_method():
    read = _tool.rule_for_method('GET')
    write = _tool.rule_for_method('POST')
    assert read['rate_per_sec'] > write['rate_per_sec'] > 0
    assert read['algorithm'] == write['algorithm'] == 'token_bucket'
    for m in ('PUT', 'PATCH', 'DELETE'):
        assert _tool.rule_for_method(m) == write


def test_all_business_modules_present(app):
    """业务模块里除 apihub 外都应有注册项（system 有 /api/admin/*）。
    diary / bookmarks 已并入 blog 子域（/api/diary、/api/bookmarks 均枚举为 blog）"""
    mods = {i['module'] for i in _tool.enumerate_routes(app)}
    for m in ('blog', 'vault', 'pwsvc', 'sdklogs', 'subs', 'system',
              'todo', 'gamemap', 'practice', 'steamidler', 'confcenter', 'shared'):
        assert m in mods, f'模块 {m} 未被枚举到'
    assert 'apihub' not in mods
    assert 'diary' not in mods and 'bookmarks' not in mods
