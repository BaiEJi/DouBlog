"""entries 白名单排序（sort_by/sort_order）——B1/B2 验收项（SQLite）。

覆盖：四列 × 双向；未传参数兼容旧顺序；只传其一的缺省组合；空/非法
字段与方向 400；注入样例 400；未授权 401；≥105 项跨三页的稳定兜底与
无重漏；两空间同 key；过滤与 q 转义；空文本/多行/中文/JSON 的 data 排序；
updated_at NULL 最后（双方向）。
"""
from datetime import datetime

from tests.confcenter.conftest import AUTH


def _put(client, namespace, key, type_, data, expect=201):
    r = client.put(f'/api/confcenter/{namespace}/{key}',
                   json={'type': type_, 'data': data}, headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()['data']


def _entries(client, **params):
    import urllib.parse
    query = urllib.parse.urlencode(params)
    r = client.get(f'/api/confcenter/entries?{query}', headers=AUTH)
    assert r.status_code == 200, r.json()
    return r.json()['data']


def _seed_direct(app, rows):
    """绕过路由直插行（造相同 updated_at / NULL updated_at 的兜底样本）。"""
    from app.db import db
    from app.confcenter.models import ConfEntry
    with db.engine.begin() as conn:
        for ns, key, type_, data, updated in rows:
            conn.execute(ConfEntry.__table__.insert().values(
                namespace=ns, key=key, type=type_, data=data, updated_at=updated))
        # namespace 登记表补齐（浏览不依赖，但保持一致性）
        from app.confcenter.models import ConfNamespace
        for ns in {r[0] for r in rows}:
            conn.execute(ConfNamespace.__table__.insert().values(namespace=ns))


# ─── B1：参数校验与兼容 ─────────────────────────────────────

def test_no_sort_params_keeps_legacy_order(client):
    """未传排序参数：保持 namespace ASC, key ASC 旧顺序与响应结构。"""
    _put(client, 'beta', 'k2', 'str', 'b2')
    _put(client, 'alpha', 'k9', 'str', 'a9')
    _put(client, 'beta', 'k1', 'str', 'b1')
    _put(client, 'alpha', 'k10', 'str', 'a10')
    d = _entries(client)
    pairs = [(i['namespace'], i['key']) for i in d['items']]
    assert pairs == [('alpha', 'k10'), ('alpha', 'k9'), ('beta', 'k1'), ('beta', 'k2')]
    assert set(d) == {'items', 'total', 'page', 'page_size', 'pages'}


def test_sort_by_only_defaults_asc(client):
    _put(client, 'app', 'b', 'str', '1')
    _put(client, 'app', 'a', 'str', '2')
    _put(client, 'app', 'c', 'str', '3')
    d = _entries(client, sort_by='key')
    assert [i['key'] for i in d['items']] == ['a', 'b', 'c']


def test_sort_order_only_sorts_key(client):
    _put(client, 'app', 'b', 'str', '1')
    _put(client, 'app', 'a', 'str', '2')
    d = _entries(client, sort_order='desc')
    assert [i['key'] for i in d['items']] == ['b', 'a']


def test_four_columns_both_directions(client, app):
    """四列 × 升/降：key/type/data/updated_at 全组合实际排序正确。"""
    t1 = datetime(2026, 1, 1, 8, 0, 0)
    t2 = datetime(2026, 1, 2, 8, 0, 0)
    t3 = datetime(2026, 1, 3, 8, 0, 0)
    # key: k-a/k-b/k-c；type: str/str/json；data: 22/33/11；time 递增对应 a/b/c
    _seed_direct(app, [
        ('app', 'k-a', 'str', '22', t1),
        ('app', 'k-b', 'str', '33', t2),
        ('app', 'k-c', 'json', '11', t3),
    ])
    keys = lambda d: [i['key'] for i in d['items']]
    assert keys(_entries(client, sort_by='key', sort_order='asc')) == ['k-a', 'k-b', 'k-c']
    assert keys(_entries(client, sort_by='key', sort_order='desc')) == ['k-c', 'k-b', 'k-a']
    # type: json < str（字典序），同 type 兜底 key asc
    assert keys(_entries(client, sort_by='type', sort_order='asc')) == ['k-c', 'k-a', 'k-b']
    assert keys(_entries(client, sort_by='type', sort_order='desc')) == ['k-a', 'k-b', 'k-c']
    # data 按存储文本：11 < 22 < 33（json 的 11 也是存储文本参与）
    assert keys(_entries(client, sort_by='data', sort_order='asc')) == ['k-c', 'k-a', 'k-b']
    assert keys(_entries(client, sort_by='data', sort_order='desc')) == ['k-b', 'k-a', 'k-c']
    # updated_at
    assert keys(_entries(client, sort_by='updated_at', sort_order='asc')) == ['k-a', 'k-b', 'k-c']
    assert keys(_entries(client, sort_by='updated_at', sort_order='desc')) == ['k-c', 'k-b', 'k-a']


def test_invalid_sort_params_400(client):
    """空值/白名单外/大小写不符 → 400；信封 success=false + PARAM 错误结构。"""
    for params in (
        {'sort_by': ''}, {'sort_by': 'namespace'}, {'sort_by': 'updated_at '},
        {'sort_by': 'key; DROP TABLE confcenter_entries'},
        {'sort_by': "(SELECT 1)"}, {'sort_by': 'KEY'},
        {'sort_order': ''}, {'sort_order': 'ascending'}, {'sort_order': 'DESC'},
    ):
        r = client.get('/api/confcenter/entries', params=params, headers=AUTH)
        assert r.status_code == 400, (params, r.json())
        body = r.json()
        assert body['success'] is False and body['code'] == 400
        assert body['data']['error_code']
    # 非法值不因另一个参数合法而放过
    r = client.get('/api/confcenter/entries',
                   params={'sort_by': 'data', 'sort_order': 'sideways'}, headers=AUTH)
    assert r.status_code == 400


def test_sort_requires_auth(client):
    for params in ({'sort_by': 'key'}, {'sort_order': 'desc'},
                   {'sort_by': 'type', 'sort_order': 'asc'}):
        r = client.get('/api/confcenter/entries', params=params)
        assert r.status_code == 401, params


# ─── B2：稳定兜底 / 分页 / 过滤 / 内容形态 ─────────────────

def test_stable_tiebreak_same_type_and_time_across_pages(client, app):
    """≥105 项、同 type、同 updated_at：三页全程按 namespace,key 稳定兜底，
    页间无重漏；两空间同 key 也按 namespace 先后。"""
    from datetime import datetime as dt
    same = dt(2026, 5, 5, 5, 5, 5)
    rows = []
    for i in range(105):
        ns = 'ns-a' if i % 2 == 0 else 'ns-b'
        rows.append((ns, f'key-{i:03d}', 'str', 'same-value', same))
    _seed_direct(app, rows)

    for order in ('asc', 'desc'):
        seen = []
        for page in (1, 2, 3):
            d = _entries(client, page=page, page_size=50, sort_by='type', sort_order=order)
            assert d['total'] == 105 and d['pages'] == 3
            seen += [(i['namespace'], i['key']) for i in d['items']]
        # desc 只反转主列（type 全同），兜底 namespace/key 仍 ASC
        expected = sorted(seen)
        assert seen == expected
        assert len(set(seen)) == 105


def test_tiebreak_two_namespaces_same_key(client, app):
    _seed_direct(app, [
        ('zeta', 'shared', 'str', 'same', datetime(2026, 3, 1)),
        ('alpha', 'shared', 'str', 'same', datetime(2026, 3, 1)),
    ])
    for order in ('asc', 'desc'):
        d = _entries(client, sort_by='data', sort_order=order)
        assert [(i['namespace'], i['key']) for i in d['items']] == [
            ('alpha', 'shared'), ('zeta', 'shared')]


def test_namespace_filter_and_q_escaping_with_sort(client, app):
    """namespace 过滤 + q 特殊字符（% _）转义下排序仍正确。"""
    _seed_direct(app, [
        ('app', 'feature%one', 'str', '10', datetime(2026, 4, 1)),
        ('app', 'feature_one', 'str', '20', datetime(2026, 4, 2)),
        ('app', 'featureXone', 'str', '30', datetime(2026, 4, 3)),
        ('other', 'feature%one', 'str', '40', datetime(2026, 4, 4)),
    ])
    d = _entries(client, namespace='app', q='feature%one', sort_by='key', sort_order='desc')
    # autoescape：'%'/“_”是字面量——仅命中真实的 feature%one
    assert [i['key'] for i in d['items']] == ['feature%one']
    d = _entries(client, q='feature_one', sort_by='data')
    assert [i['key'] for i in d['items']] == ['feature_one']  # _ 不作通配
    d = _entries(client, namespace='other', sort_by='data', sort_order='desc')
    assert [i['key'] for i in d['items']] == ['feature%one']


def test_data_sort_text_shapes(client, app):
    """空文本/多行/中文/JSON 标量与对象：按存储文本字典序（区分大小写）。"""
    _seed_direct(app, [
        ('app', 'k-empty', 'str', '', datetime(2026, 2, 1)),
        ('app', 'k-multi', 'str', 'a\nb\nc', datetime(2026, 2, 2)),
        ('app', 'k-cjk', 'str', '中文值', datetime(2026, 2, 3)),
        ('app', 'k-json-scalar', 'json', '0.75', datetime(2026, 2, 4)),
        ('app', 'k-json-obj', 'json', '{"a":1}', datetime(2026, 2, 5)),
        ('app', 'k-upper', 'str', 'Zebra', datetime(2026, 2, 6)),
        ('app', 'k-lower', 'str', 'apple', datetime(2026, 2, 7)),
    ])
    d = _entries(client, sort_by='data')
    # 存储文本 UTF-8 字节序（=码点序）：''(空) < '0.75' < 'Zebra'(0x5A) < 'a\nb\nc'
    # (\n=0x0A<p=0x70) < 'apple' < '{"a":1}'('{'=0x7B) < '中文值'(0xE4..)
    expected = ['k-empty', 'k-json-scalar', 'k-upper', 'k-multi',
                'k-lower', 'k-json-obj', 'k-cjk']
    assert [i['key'] for i in d['items']] == expected
    d = _entries(client, sort_by='data', sort_order='desc')
    assert [i['key'] for i in d['items']] == list(reversed(expected))


def test_updated_at_nulls_last_both_directions(client, app):
    _seed_direct(app, [
        ('app', 'k-null-1', 'str', '1', None),
        ('app', 'k-old', 'str', '2', datetime(2026, 1, 1)),
        ('app', 'k-null-2', 'str', '3', None),
        ('app', 'k-new', 'str', '4', datetime(2026, 6, 1)),
    ])
    asc = _entries(client, sort_by='updated_at')
    assert [i['key'] for i in asc['items']] == ['k-old', 'k-new', 'k-null-1', 'k-null-2']
    desc = _entries(client, sort_by='updated_at', sort_order='desc')
    assert [i['key'] for i in desc['items']] == ['k-new', 'k-old', 'k-null-1', 'k-null-2']


def test_paging_no_gap_or_overlap_with_sort(client, app):
    """105 项跨三页：每页 50，排序键唯一（key），两方向页序无重漏。"""
    from datetime import timedelta
    base = datetime(2026, 7, 1)
    rows = [('app', f'k-{i:03d}', 'str', f'v{i}', base + timedelta(minutes=i))
            for i in range(105)]
    _seed_direct(app, rows)
    for order in ('asc', 'desc'):
        seen = []
        for page in (1, 2, 3):
            d = _entries(client, page=page, page_size=50, sort_by='key', sort_order=order)
            seen += [i['key'] for i in d['items']]
        assert len(seen) == 105 and len(set(seen)) == 105
        expected = sorted(f'k-{i:03d}' for i in range(105))
        assert seen == (expected if order == 'asc' else list(reversed(expected)))
