"""
订阅管理（subs，CrownFlow 迁移）测试：分类/会员/订阅 CRUD 与校验、
会员聚合字段、支出统计（含汇率折算/趋势粒度）、到期提醒、每日任务。
"""
import base64
from datetime import date, datetime, timedelta

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()}


@pytest.fixture
def auth_headers():
    return AUTH


def _cat(client, name='视频', icon='🎬', color='#1890ff', headers=AUTH):
    r = client.post('/api/subs/categories', json={'name': name, 'icon': icon, 'color': color},
                    headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _member(client, name='Netflix', headers=AUTH, **kw):
    payload = {'name': name}
    payload.update({k: v for k, v in kw.items() if v is not None})
    r = client.post('/api/subs/members', json=payload, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _sub_payload(**kw):
    p = {
        'level': '标准版',
        'price': 30,
        'currency': 'CNY',
        'billing_cycle': 'monthly',
        'start_date': date.today().replace(day=1).isoformat(),
        'end_date': (date.today().replace(day=1) + timedelta(days=30)).isoformat(),
        'channel': '官方',
    }
    p.update(kw)
    return p


# ─── 分类 ─────────────────────────────────────────────────

def test_category_crud(client, auth_headers):
    cat = _cat(client, '音乐', '🎵', '#52c41a')
    assert cat['name'] == '音乐' and cat['icon'] == '🎵' and cat['color'] == '#52c41a'

    r = client.get('/api/subs/categories', headers=AUTH)
    assert any(c['id'] == cat['id'] for c in r.json()['data'])

    r = client.put(f"/api/subs/categories/{cat['id']}",
                   json={'name': '音乐服务', 'color': '#722ed1'}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['name'] == '音乐服务'

    r = client.delete(f"/api/subs/categories/{cat['id']}", headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['deleted'] is True


def test_category_validations(client, auth_headers):
    # 名称必填 / 超长
    assert client.post('/api/subs/categories', json={'name': '  '}, headers=AUTH).status_code == 400
    assert client.post('/api/subs/categories', json={'name': 'x' * 51}, headers=AUTH).status_code == 400
    # 重名（创建 & 更新时与他分类撞名）
    _cat(client, '视频')
    r = client.post('/api/subs/categories', json={'name': '视频'}, headers=AUTH)
    assert r.status_code == 409
    other = _cat(client, '工具')
    r = client.put(f"/api/subs/categories/{other['id']}", json={'name': '视频'}, headers=AUTH)
    assert r.status_code == 409
    # 不存在
    assert client.put('/api/subs/categories/999', json={'name': 'x'}, headers=AUTH).status_code == 404
    assert client.delete('/api/subs/categories/999', headers=AUTH).status_code == 404
    # 有会员关联时拒绝删除
    cat = _cat(client, '关联分类')
    _member(client, 'A', category_id=cat['id'])
    r = client.delete(f"/api/subs/categories/{cat['id']}", headers=AUTH)
    assert r.status_code == 400
    assert '存在会员' in r.json()['message']


# ─── 会员 ─────────────────────────────────────────────────

def test_member_crud_with_first_subscription(client, auth_headers):
    cat = _cat(client, '视频')
    r = client.post('/api/subs/members', json={
        'name': 'Netflix', 'category_id': cat['id'], 'notes': '追剧',
        'reminder_days': 14,
        'subscription': _sub_payload(price=60, level='高级版'),
    }, headers=AUTH)
    assert r.status_code == 201, r.json()
    m = r.json()['data']
    assert m['name'] == 'Netflix'
    assert m['category']['name'] == '视频'
    assert m['reminder_days'] == 14
    assert m['status'] == 'active'
    assert m['subscription_count'] == 1
    assert len(m['subscriptions']) == 1
    assert m['latest_subscription']['level'] == '高级版'

    # 更新主表
    r = client.put(f"/api/subs/members/{m['id']}", json={'name': '网飞', 'reminder_days': 3},
                   headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['name'] == '网飞'
    assert r.json()['data']['reminder_days'] == 3

    # 详情
    r = client.get(f"/api/subs/members/{m['id']}", headers=AUTH)
    assert r.status_code == 200 and 'subscriptions' in r.json()['data']

    # 删除（级联订阅）
    r = client.delete(f"/api/subs/members/{m['id']}", headers=AUTH)
    assert r.status_code == 200
    assert client.get(f"/api/subs/members/{m['id']}", headers=AUTH).status_code == 404
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions", headers=AUTH)
    assert r.status_code == 404


def test_member_validations(client, auth_headers):
    assert client.post('/api/subs/members', json={'name': ''}, headers=AUTH).status_code == 400
    assert client.post('/api/subs/members', json={'name': ' ' * 5}, headers=AUTH).status_code == 400
    assert client.post('/api/subs/members', json={'name': 'x' * 101}, headers=AUTH).status_code == 400
    assert client.post('/api/subs/members', json={'name': 'A', 'category_id': 999},
                       headers=AUTH).status_code == 400
    assert client.put('/api/subs/members/999', json={'name': 'x'}, headers=AUTH).status_code == 404
    # 创建时附带非法首条订阅：整体失败，不落会员
    bad = _sub_payload(price=-1)
    r = client.post('/api/subs/members', json={'name': '坏订阅', 'subscription': bad}, headers=AUTH)
    assert r.status_code == 400
    r = client.get('/api/subs/members?keyword=坏订阅', headers=AUTH)
    assert r.json()['data']['total'] == 0


def test_member_list_filters_and_sort(client, auth_headers):
    cat_a = _cat(client, '视频')
    cat_b = _cat(client, '音乐')
    m1 = _member(client, 'Netflix', category_id=cat_a['id'],
                 subscription=_sub_payload(price=60))
    m2 = _member(client, 'QQ音乐', category_id=cat_b['id'],
                 subscription=_sub_payload(price=8))
    m3 = _member(client, '已过期君', subscription=_sub_payload(
        start_date='2020-01-01', end_date='2020-06-01'))

    # 分页
    r = client.get('/api/subs/members?page=1&page_size=2', headers=AUTH)
    d = r.json()['data']
    assert d['total'] == 3 and len(d['items']) == 2
    # keyword
    r = client.get('/api/subs/members?keyword=net', headers=AUTH)
    assert r.json()['data']['total'] == 1
    # category
    r = client.get(f"/api/subs/members?category_id={cat_a['id']}", headers=AUTH)
    assert r.json()['data']['total'] == 1
    # status
    r = client.get('/api/subs/members?status=active', headers=AUTH)
    names = [i['name'] for i in r.json()['data']['items']]
    assert '已过期君' not in names and {'Netflix', 'QQ音乐'} <= set(names)
    r = client.get('/api/subs/members?status=expired', headers=AUTH)
    assert [i['name'] for i in r.json()['data']['items']] == ['已过期君']
    assert client.get('/api/subs/members?status=weird', headers=AUTH).status_code == 400
    # 排序（名称升序 / 非法字段 400）
    r = client.get('/api/subs/members?sort_by=name&order=asc', headers=AUTH)
    names = [i['name'] for i in r.json()['data']['items']]
    assert names == sorted(names, key=str)
    assert client.get('/api/subs/members?sort_by=hacked', headers=AUTH).status_code == 400
    # 无凭据 401
    assert client.get('/api/subs/members').status_code == 401


# ─── 订阅记录 ─────────────────────────────────────────────

def test_subscription_crud(client, auth_headers):
    m = _member(client, 'Spotify')
    r = client.post(f"/api/subs/members/{m['id']}/subscriptions",
                    json=_sub_payload(price=10.5, currency='USD', billing_cycle='yearly',
                                      channel='代充'), headers=AUTH)
    assert r.status_code == 201, r.json()
    sub = r.json()['data']
    assert sub['currency'] == 'USD' and sub['price'] == 10.5

    # 单条详情带 member_name
    r = client.get(f"/api/subs/subscriptions/{sub['id']}", headers=AUTH)
    assert r.json()['data']['member_name'] == 'Spotify'

    # 更新
    r = client.put(f"/api/subs/subscriptions/{sub['id']}", json={'price': 99, 'level': '家庭版'},
                   headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['price'] == 99 and d['level'] == '家庭版'

    # 列表筛选：状态 / 日期范围 / 排序
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions?status=active", headers=AUTH)
    assert r.json()['data']['total'] == 1
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions?status=expired", headers=AUTH)
    assert r.json()['data']['total'] == 0
    assert client.get(f"/api/subs/members/{m['id']}/subscriptions?status=x", headers=AUTH).status_code == 400
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions"
                   f"?start_date={date.today().isoformat()}&end_date={date.today().isoformat()}",
                   headers=AUTH)
    assert r.json()['data']['total'] == 1   # 今日被订阅覆盖
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions"
                   f"?start_date=2019-01-01&end_date=2019-12-31", headers=AUTH)
    assert r.json()['data']['total'] == 0
    r = client.get(f"/api/subs/members/{m['id']}/subscriptions?sort_by=price&order=asc",
                   headers=AUTH)
    assert r.status_code == 200
    assert client.get(f"/api/subs/members/{m['id']}/subscriptions?sort_by=oops",
                      headers=AUTH).status_code == 400

    # 删除
    assert client.delete(f"/api/subs/subscriptions/{sub['id']}", headers=AUTH).status_code == 200
    assert client.get(f"/api/subs/subscriptions/{sub['id']}", headers=AUTH).status_code == 404
    assert client.delete('/api/subs/subscriptions/999', headers=AUTH).status_code == 404


def test_subscription_validations(client, auth_headers):
    m = _member(client, '校验君')
    base = f"/api/subs/members/{m['id']}/subscriptions"
    cases = [
        ({**_sub_payload(), 'price': None}, '价格不能为空'),
        ({**_sub_payload(), 'price': -5}, '不能为负数'),
        ({**_sub_payload(), 'price': 'abc'}, '有效数字'),
        ({**_sub_payload(), 'billing_cycle': None}, '计费周期不能为空'),
        ({**_sub_payload(), 'billing_cycle': 'weekly'}, '计费周期必须是'),
        ({**_sub_payload(), 'currency': 'XXX'}, '币种必须是'),
        ({**_sub_payload(), 'start_date': '2026/01/01'}, '格式错误'),
        ({**_sub_payload(), 'end_date': ''}, '结束日期不能为空'),
        ({**_sub_payload(), 'start_date': '2026-03-01', 'end_date': '2026-02-01'},
         '开始日期不能大于结束日期'),
        ({**_sub_payload(), 'billing_cycle': 'custom'}, 'custom_days'),
    ]
    for payload, msg in cases:
        r = client.post(base, json=payload, headers=AUTH)
        assert r.status_code == 400, (payload, r.json())
        assert msg in r.json()['message'], (payload, r.json())
    # custom + custom_days=0
    r = client.post(base, json=_sub_payload(billing_cycle='custom', custom_days=0), headers=AUTH)
    assert r.status_code == 400
    # 合法 custom
    r = client.post(base, json=_sub_payload(billing_cycle='custom', custom_days=45), headers=AUTH)
    assert r.status_code == 201
    sub_id = r.json()['data']['id']
    # 更新切到 custom 但无 custom_days → 400
    r = client.put(f'/api/subs/subscriptions/{sub_id}', json={'billing_cycle': 'custom',
                                                              'custom_days': None}, headers=AUTH)
    assert r.status_code == 400
    # 更新把日期改成 start > end → 400
    r = client.put(f'/api/subs/subscriptions/{sub_id}', json={'start_date': '2030-01-01'},
                   headers=AUTH)
    assert r.status_code == 400
    assert client.post('/api/subs/members/999/subscriptions', json=_sub_payload(),
                       headers=AUTH).status_code == 404


# ─── 会员聚合字段 ─────────────────────────────────────────

def test_member_aggregation(client, auth_headers):
    m = _member(client, '聚合君', subscription=_sub_payload(price=30))   # CNY 30/月
    client.post(f"/api/subs/members/{m['id']}/subscriptions",
                json=_sub_payload(price=10, currency='USD'), headers=AUTH)  # 折算 70
    r = client.get(f"/api/subs/members/{m['id']}", headers=AUTH)
    d = r.json()['data']
    assert d['subscription_count'] == 2
    assert d['total_spending'] == 100.0          # 30 + 10×7.0
    assert d['total_duration_days'] == 60        # 30 天 × 2
    assert d['status'] == 'active'
    # 列表接口同样带聚合字段
    r = client.get('/api/subs/members?keyword=聚合君', headers=AUTH)
    item = r.json()['data']['items'][0]
    assert item['total_spending'] == 100.0 and item['subscription_count'] == 2
    # latest_subscription 取最新创建的有效订阅（USD 那条）
    assert item['latest_subscription']['currency'] == 'USD'


# ─── 统计 ─────────────────────────────────────────────────

def _seed_stats_data(client):
    cat = _cat(client, '视频', color='#f5222d')
    m = _member(client, 'Netflix', category_id=cat['id'])
    # 月付 30 元：本月覆盖天数 = min(今天,月末) - 月初 + 1
    first = date.today().replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    client.post(f"/api/subs/members/{m['id']}/subscriptions",
                json=_sub_payload(price=30, start_date=first.isoformat(),
                                  end_date=(nxt - timedelta(days=1)).isoformat()), headers=AUTH)
    return cat, m, first, nxt


def test_stats_overview_and_summary(client, auth_headers):
    cat, m, first, nxt = _seed_stats_data(client)
    r = client.get('/api/subs/stats/overview', headers=AUTH)
    d = r.json()['data']
    assert d['total_members'] == 1 and d['active_members'] == 1
    # 月/年支出按「日均 × 整月/整年覆盖天数」计算（CrownFlow 口径）：本月整月恰好一周期 → 30
    assert d['monthly_spending'] == pytest.approx(30.0, abs=0.02)
    assert d['yearly_spending'] == pytest.approx(30.0, abs=0.02)

    r = client.get('/api/subs/stats/category-summary', headers=AUTH)
    d = r.json()['data']
    assert d['categories'][0]['category_name'] == '视频'
    assert d['total_monthly'] == pytest.approx(30.0, abs=0.02)


def test_stats_spending_and_by_category(client, auth_headers):
    cat, m, first, nxt = _seed_stats_data(client)
    # USD 订阅加入，验证汇率折算与 by_currency 原币统计
    client.post(f"/api/subs/members/{m['id']}/subscriptions",
                json=_sub_payload(price=7, currency='USD', billing_cycle='custom', custom_days=7,
                                  start_date=first.isoformat(),
                                  end_date=(first + timedelta(days=6)).isoformat()), headers=AUTH)
    qs = f'start_date={first.isoformat()}&end_date={(nxt - timedelta(days=1)).isoformat()}'
    r = client.get(f'/api/subs/stats/spending?{qs}', headers=AUTH)
    d = r.json()['data']
    month_days = (nxt - first).days
    assert d['total'] == pytest.approx(30 + 7 * 7.0, abs=0.02)      # USD 7 → CNY 49
    assert d['by_currency']['CNY'] == pytest.approx(30, abs=0.02)
    assert d['by_currency']['USD'] == pytest.approx(7, abs=0.02)
    assert d['categories'][0]['category_name'] == '视频'
    assert d['categories'][0]['count'] == 2
    assert 0 < d['categories'][0]['percentage'] <= 100
    assert d['daily_average'] == pytest.approx((30 + 49) / month_days, abs=0.02)

    r = client.get(f'/api/subs/stats/by-category?{qs}', headers=AUTH)
    d = r.json()['data']
    assert d['total'] == pytest.approx(79, abs=0.02)
    det = d['categories'][0]['details']
    assert len(det) == 2 and det[0]['amount'] >= det[1]['amount']

    # 缺参数 / 顺序颠倒 / 非法日期
    assert client.get('/api/subs/stats/spending', headers=AUTH).status_code == 400
    assert client.get('/api/subs/stats/spending?start_date=2026-01-02&end_date=2026-01-01',
                      headers=AUTH).status_code == 400
    assert client.get('/api/subs/stats/spending?start_date=xx&end_date=2026-01-01',
                      headers=AUTH).status_code == 400


def test_stats_trend_granularities(client, auth_headers):
    cat, m, first, nxt = _seed_stats_data(client)
    qs = f'start_date=2026-01-01&end_date=2026-12-31'
    for g, expect_n in (('month', 12), ('quarter', 4), ('week', None), ('day', None)):
        r = client.get(f'/api/subs/stats/trend?{qs}&granularity={g}', headers=AUTH)
        assert r.status_code == 200, r.json()
        trend = r.json()['data']['trend']
        if expect_n:
            assert len(trend) == expect_n
        assert all('date' in t and 'amount' in t and isinstance(t['details'], list)
                   for t in trend)
    # 12 个月标签
    r = client.get(f'/api/subs/stats/trend?{qs}&granularity=month', headers=AUTH)
    assert r.json()['data']['trend'][0]['date'] == '2026-01'
    # 季度标签
    r = client.get(f'/api/subs/stats/trend?{qs}&granularity=quarter', headers=AUTH)
    assert r.json()['data']['trend'][0]['date'] == '2026-Q1'
    # 周标签 mm/dd-mm/dd；day 标签为日期本身
    r = client.get(f'/api/subs/stats/trend?start_date=2026-01-05&end_date=2026-01-06&granularity=day',
                   headers=AUTH)
    trend = r.json()['data']['trend']
    assert [t['date'] for t in trend] == ['2026-01-05', '2026-01-06']
    # 金额核对：月粒度下 2026-01 无订阅（种子在本月），除非本月是 2026-01
    r = client.get(f'/api/subs/stats/trend?{qs}&granularity=month', headers=AUTH)
    jan = r.json()['data']['trend'][0]
    if first.isoformat() != '2026-01-01':
        assert jan['amount'] == 0
    else:
        assert jan['amount'] > 0
    # 非法粒度 / 缺日期
    assert client.get(f'/api/subs/stats/trend?{qs}&granularity=year', headers=AUTH).status_code == 400
    assert client.get('/api/subs/stats/trend?granularity=month', headers=AUTH).status_code == 400


# ─── 提醒 ─────────────────────────────────────────────────

def test_reminders(client, auth_headers):
    cat = _cat(client, '视频')
    today = date.today()
    # 3 天后到期（会员 reminder_days=7 → 提醒内）；30 天后到期（不在提醒内）；已到期（不出现）
    m1 = _member(client, '快到期', category_id=cat['id'],
                 subscription=_sub_payload(end_date=(today + timedelta(days=3)).isoformat()))
    m2 = _member(client, '还很久', subscription=_sub_payload(end_date=(today + timedelta(days=30)).isoformat()))
    m3 = _member(client, '已过期', subscription=_sub_payload(start_date='2020-01-01',
                                                             end_date='2020-02-01'))
    r = client.get('/api/subs/reminders/upcoming', headers=AUTH)
    reminders = r.json()['data']['reminders']
    names = [x['member_name'] for x in reminders]
    assert names == ['快到期']                       # 只剩 3 天那条
    item = reminders[0]
    assert item['days_remaining'] == 3
    assert item['category_name'] == '视频' and item['category_icon'] == '🎬'
    assert item['price'] == 30 and item['currency'] == 'CNY'

    # reminder_days=0 的会员：只有当天到期（days_remaining=0 <= 0）才提醒
    r = client.put(f"/api/subs/members/{m1['id']}", json={'reminder_days': 1}, headers=AUTH)
    assert r.status_code == 200
    r = client.get('/api/subs/reminders/upcoming', headers=AUTH)
    assert [x['member_name'] for x in r.json()['data']['reminders']] == []

    # all：含 30 天后到期，不含已过期
    r = client.get('/api/subs/reminders/all', headers=AUTH)
    names = [x['member_name'] for x in r.json()['data']['reminders']]
    assert set(names) == {'快到期', '还很久'}
    days = [x['days_remaining'] for x in r.json()['data']['reminders']]
    assert days == sorted(days)


# ─── 每日任务 ─────────────────────────────────────────────

def test_daily_spending_log(client, auth_headers, app):
    from app.subs.routes import run_daily_spending_log
    _member(client, '日志君', subscription=_sub_payload(price=30))
    msg = run_daily_spending_log(app)
    assert '活跃订阅 1 个' in msg
    assert '今日总支出: ¥1.' in msg or '今日总支出: ¥0.' in msg   # 日均 30/31≈0.97 或 30/30
    assert '未分类' in msg                                         # 会员未设分类 → 归入未分类桶
    # 无订阅时
    _member(client, '空君')
    # （不去断言第二条输出，仅保证函数可重复执行）
    run_daily_spending_log(app)
