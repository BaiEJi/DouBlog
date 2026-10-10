"""
日记（随记+每日总结）测试：随记分本必选、每日总结 upsert、时间线 kind 排序、
置顶/归档/回收站、天气位置、分享、导出、模板/引导、日历/热力图/那年今日/统计。
"""
import io
import zipfile
from datetime import date, timedelta

import pytest

AUTH = {'Authorization': 'Basic ' + __import__('base64').b64encode(b"admin:lizy111A").decode()}


@pytest.fixture
def auth_headers():
    return AUTH


def _journals(client):
    js = client.get('/api/diary/journals', headers=AUTH).json()['data']
    return {j['name']: j['id'] for j in js}


def _create(client, headers=AUTH, **kw):
    payload = {'content': kw.get('content', '一条随记'),
               'entry_date': kw.get('entry_date', date.today().isoformat()),
               'journal_id': kw.get('journal_id', _journals(client)['日常'])}
    for k in ('mood', 'kind', 'weather', 'location'):
        if kw.get(k) is not None:
            payload[k] = kw[k]
    r = client.post('/api/diary/entries', json=payload, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _list(client, qs='', headers=AUTH):
    r = client.get(f'/api/diary/entries{qs}', headers=headers)
    assert r.status_code == 200, r.json()
    return r.json()['data']


# ─── 预置日记本 ─────────────────────────────────────────

def test_preset_journals(client, auth_headers):
    js = client.get('/api/diary/journals', headers=AUTH).json()['data']
    names = {j['name'] for j in js}
    assert {'日常', '工作', '感悟'} <= names
    assert all('entry_count' in j for j in js)
    assert not any(j.get('virtual') for j in js)


def test_note_requires_journal(client, auth_headers):
    r = client.post('/api/diary/entries',
                    json={'content': 'x', 'entry_date': date.today().isoformat()}, headers=AUTH)
    assert r.status_code == 400
    r = client.post('/api/diary/entries',
                    json={'content': 'x', 'entry_date': date.today().isoformat(), 'journal_id': 999},
                    headers=AUTH)
    assert r.status_code == 400
    d = _create(client, content='无标签时代')
    assert 'tags' not in d


def test_note_assigned_to_journal(client, auth_headers):
    jid = _journals(client)['工作']
    d = _create(client, content='工作随记', journal_id=jid)
    assert d['journal_id'] == jid and d['kind'] == 'note'
    lst = _list(client, f'?journal_id={jid}')
    assert all(i['journal_id'] == jid for i in lst['items'])


# ─── 每日总结 ────────────────────────────────────────────

def test_summary_upsert_once_per_day(client, auth_headers):
    today = date.today().isoformat()
    _create(client, content='白天随记一')
    _create(client, content='白天随记二', journal_id=_journals(client)['感悟'])
    r1 = client.post('/api/diary/summary',
                     json={'entry_date': today, 'content': '今天的总结：高效的一天', 'mood': 'good'},
                     headers=AUTH)
    assert r1.status_code == 201 and r1.json()['data']['created'] is True
    s1 = r1.json()['data']['summary']
    assert s1['kind'] == 'summary' and s1['journal_id'] is None
    assert r1.json()['data']['notes'][0]['content'].startswith('白天随记二')

    r2 = client.post('/api/diary/summary',
                     json={'entry_date': today, 'content': '改过的总结'}, headers=AUTH)
    assert r2.status_code == 200
    d2 = r2.json()['data']
    assert d2['created'] is False and d2['summary']['id'] == s1['id']
    assert d2['summary']['content'] == '改过的总结'
    kinds = [i['kind'] for i in _list(client)['items']]
    assert kinds.count('summary') == 1
    assert client.post('/api/diary/summary', json={'entry_date': 'bad', 'content': 'x'},
                       headers=AUTH).status_code == 400


def test_timeline_summary_first_then_notes(client, auth_headers):
    _create(client, content='随记A')
    _create(client, content='随记B', journal_id=_journals(client)['工作'])
    client.post('/api/diary/summary',
                json={'entry_date': date.today().isoformat(), 'content': '当日总结'}, headers=AUTH)
    items = _list(client)['items']
    assert items[0]['kind'] == 'summary'
    assert [i['content'][:3] for i in items[1:3]] == ['随记B', '随记A']


def test_summary_edit_and_flow(client, auth_headers):
    today = date.today().isoformat()
    sid = client.post('/api/diary/summary',
                      json={'entry_date': today, 'content': 'v1'}, headers=AUTH).json()['data']['summary']['id']
    r = client.put(f'/api/diary/entries/{sid}',
                   json={'entry_date': today, 'content': 'v2 编辑后的总结'}, headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['content'] == 'v2 编辑后的总结'
    assert client.put(f'/api/diary/entries/{sid}?action=pin', headers=AUTH).status_code == 200
    assert client.delete(f'/api/diary/entries/{sid}', headers=AUTH).status_code == 200
    r2 = client.post('/api/diary/summary', json={'entry_date': today, 'content': '重写'}, headers=AUTH)
    assert r2.status_code == 201 and r2.json()['data']['created'] is True


# ─── 随记 CRUD / 置顶 / 归档 / 回收站 ────────────────────

def test_update_flow(client, auth_headers):
    d = _create(client, mood='good')
    assert d['mood'] == 'good' and d['word_count'] > 0
    r = client.put(f"/api/diary/entries/{d['id']}",
                   json={'content': '改了内容', 'entry_date': d['entry_date'],
                         'journal_id': d['journal_id']}, headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['content'] == '改了内容'
    jid = _journals(client)['感悟']
    r = client.put(f"/api/diary/entries/{d['id']}", json={'journal_id': jid}, headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['journal_id'] == jid


def test_validation_errors(client, auth_headers):
    for bad in (
        {'content': 'x', 'entry_date': '2026-13-40'},
        {'content': 'x', 'entry_date': '2026-09-19', 'mood': 'happy'},
        {'content': 'x', 'entry_date': '2026-09-19', 'kind': 'other'},
    ):
        assert client.post('/api/diary/entries',
                           json={**bad, 'journal_id': _journals(client)['日常']},
                           headers=AUTH).status_code == 400


def test_pin_and_order(client, auth_headers):
    a = _create(client, content='旧篇', entry_date=(date.today() - timedelta(days=3)).isoformat())
    b = _create(client, content='新篇')
    client.put(f"/api/diary/entries/{a['id']}?action=pin", headers=AUTH)
    items = _list(client)['items']
    assert items[0]['id'] == a['id'] and items[0]['pinned'] is True
    pv = _list(client, '?view=pinned')
    assert [i['id'] for i in pv['items']] == [a['id']]
    client.put(f"/api/diary/entries/{a['id']}?action=unpin", headers=AUTH)
    assert _list(client)['items'][0]['id'] == b['id']


def test_trash_restore_purge(client, auth_headers):
    d = _create(client)
    assert client.delete(f"/api/diary/entries/{d['id']}", headers=AUTH).status_code == 200
    assert all(i['id'] != d['id'] for i in _list(client)['items'])
    trash = _list(client, '?view=trash')
    assert [i['id'] for i in trash['items']] == [d['id']]
    e2 = _create(client, content='另一篇')
    assert client.delete(f"/api/diary/entries/{e2['id']}?hard=1", headers=AUTH).status_code == 400
    assert client.put(f"/api/diary/entries/{d['id']}?action=restore", headers=AUTH).status_code == 200
    assert any(i['id'] == d['id'] for i in _list(client)['items'])
    client.delete(f"/api/diary/entries/{d['id']}", headers=AUTH)
    assert client.delete(f"/api/diary/entries/{d['id']}?hard=1", headers=AUTH).status_code == 200
    assert client.delete(f"/api/diary/entries/{d['id']}", headers=AUTH).status_code == 404


def test_archive_flow(client, auth_headers):
    d = _create(client)
    client.put(f"/api/diary/entries/{d['id']}?action=archive", headers=AUTH)
    assert all(i['id'] != d['id'] for i in _list(client)['items'])
    av = _list(client, '?view=archive')
    assert [i['id'] for i in av['items']] == [d['id']] and av['items'][0]['archived'] is True
    client.put(f"/api/diary/entries/{d['id']}?action=unarchive", headers=AUTH)
    assert any(i['id'] == d['id'] for i in _list(client)['items'])


def test_quick_capture_requires_journal(client, auth_headers):
    jid = _journals(client)['日常']
    r = client.post('/api/diary/quick',
                    json={'content': '一句话打卡', 'mood': 'good', 'journal_id': jid}, headers=AUTH)
    assert r.status_code == 201
    d = r.json()['data']
    assert d['entry_date'] == date.today().isoformat() and d['journal_id'] == jid
    assert client.post('/api/diary/quick', json={'content': 'x'}, headers=AUTH).status_code == 400
    assert client.post('/api/diary/quick', json={'content': '  '}, headers=AUTH).status_code == 400


def test_filters_search_mood_date(client, auth_headers):
    _create(client, content='去爬了山，天气很好', mood='great')
    _create(client, content='加班到深夜', journal_id=_journals(client)['工作'], mood='low')
    _create(client, content='看完了一本书', journal_id=_journals(client)['感悟'], mood='good',
            entry_date=(date.today() - timedelta(days=10)).isoformat())
    assert _list(client, '?search=天气很好')['total'] >= 1
    assert all(i['mood'] == 'low' for i in _list(client, '?mood=low')['items'])
    assert _list(client, f"?start={date.today().isoformat()}")['total'] == 2


def test_month_dates_shape(client, auth_headers):
    today = date.today()
    _create(client, mood='great')
    _create(client, mood='low')
    d = client.get(f'/api/diary/dates?year={today.year}&month={today.month}',
                   headers=AUTH).json()['data']
    assert d['days'][today.isoformat()]['count'] == 2
    assert d['days'][today.isoformat()]['mood'] == 'great'


def test_heatmap(client, auth_headers):
    y = date.today().year
    for i in range(3):
        _create(client, content=f'a{i}')
    hm = client.get(f'/api/diary/heatmap?year={y}', headers=AUTH).json()['data']
    assert hm['max'] >= 3
    assert hm['days'][date.today().isoformat()]['count'] == 3


def test_onthisday(client, auth_headers):
    md = date.today().strftime('%m-%d')
    same_md = None
    for yoff in (1, 4):
        try:
            cand = f'{date.today().year - yoff}-{md}'
            date.fromisoformat(cand)
            same_md = cand
            break
        except ValueError:
            continue
    if same_md:
        _create(client, content='往年今日的事', entry_date=same_md)
    d = client.get('/api/diary/onthisday', headers=AUTH).json()['data']
    assert d['today'] == date.today().isoformat()
    if same_md:
        assert any(same_md == e['entry_date'] for e in d['past'])


def test_stats_and_streaks(client, auth_headers):
    today = date.today()
    for i in range(3):
        _create(client, content=f'day{i}', entry_date=(today - timedelta(days=i)).isoformat())
    _create(client, content='gap', entry_date=(today - timedelta(days=5)).isoformat())
    s = client.get('/api/diary/stats', headers=AUTH).json()['data']
    assert s['current_streak'] == 3 and s['longest_streak'] == 3
    assert s['total'] == 4 and s['words'] > 0


def test_trends_months_backfilled(client, auth_headers):
    _create(client, content='唯一一篇')
    t = client.get('/api/diary/trends?months=6', headers=AUTH).json()['data']['months']
    assert len(t) == 6
    assert t[-1]['entries'] == 1 and t[-1]['words'] > 0
    assert t[0]['entries'] == 0
    assert all('mood_avg' in m for m in t)


def test_yearend_no_tags(client, auth_headers):
    y = date.today().year
    _create(client, content='年度回顾用', mood='good')
    d = client.get(f'/api/diary/yearend?year={y}', headers=AUTH).json()['data']
    assert d['entries'] >= 1 and d['mood_dist'].get('good') == 1
    assert 'top_tags' not in d


def test_share_lifecycle(client, auth_headers):
    d = _create(client, content='要分享的日记内容')
    r = client.post(f"/api/diary/entries/{d['id']}/share", json={'expires_hours': 1}, headers=AUTH)
    assert r.status_code == 201
    token = r.json()['data']['token']
    pub = client.get(f'/api/diary/share/{token}')
    assert pub.status_code == 200
    pe = pub.json()['data']['entry']
    assert pe['content'] == '要分享的日记内容'
    assert 'id' not in pe and 'tags' not in pe
    assert client.get('/api/diary/share/nope').status_code == 404
    client.delete(f"/api/diary/entries/{d['id']}/share", headers=AUTH)
    assert client.get(f'/api/diary/share/{token}').status_code == 404
    assert client.post(f"/api/diary/entries/{d['id']}/share", json={'expires_hours': 0},
                       headers=AUTH).status_code == 400


def test_share_blocked_after_trash(client, auth_headers):
    d = _create(client)
    token = client.post(f"/api/diary/entries/{d['id']}/share", json={'expires_hours': 24},
                        headers=AUTH).json()['data']['token']
    client.delete(f"/api/diary/entries/{d['id']}", headers=AUTH)
    assert client.get(f'/api/diary/share/{token}').status_code == 404


def test_journals_crud_and_guard(client, auth_headers):
    j = client.post('/api/diary/journals', json={'name': '旅行', 'emoji': 'F'}, headers=AUTH)
    assert j.status_code == 201
    jid = j.json()['data']['id']
    _create(client, content='旅行随记', journal_id=jid)
    assert client.delete(f'/api/diary/journals/{jid}', headers=AUTH).status_code == 409
    js = client.get('/api/diary/journals', headers=AUTH).json()['data']
    assert any(x['id'] == jid and x['entry_count'] == 1 for x in js)
    assert client.put(f'/api/diary/journals/{jid}', json={'name': '旅途'}, headers=AUTH).status_code == 200
    assert client.post('/api/diary/journals', json={'name': '旅途'}, headers=AUTH).status_code == 409
    items = _list(client, f'?journal_id={jid}')['items']
    for it in items:
        client.delete(f"/api/diary/entries/{it['id']}", headers=AUTH)
        client.delete(f"/api/diary/entries/{it['id']}?hard=1", headers=AUTH)
    assert client.delete(f'/api/diary/journals/{jid}', headers=AUTH).status_code == 200


def test_weather_location_persist(client, auth_headers):
    _create(client, weather={'temp': 26.5, 'text': '晴', 'junk': 'drop'},
            location={'lat': 31.23, 'lon': 121.47, 'place': '上海'})
    got = _list(client)['items'][0]
    assert got['weather']['temp'] == 26.5 and 'junk' not in got['weather']
    assert got['location']['place'] == '上海'


def test_export_zip(client, auth_headers):
    _create(client, content='导出用标题', mood='good')
    client.post('/api/diary/summary',
                json={'entry_date': date.today().isoformat(), 'content': '总结也要导出'}, headers=AUTH)
    r = client.get('/api/diary/export', headers=AUTH)
    assert r.status_code == 200 and r.headers['content-type'] == 'application/zip'
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    mds = [n for n in names if n.endswith('.md')]
    assert 'README.txt' in names and len(mds) >= 2
    body = zf.read(mds[0]).decode('utf-8')
    assert body.startswith('---') and 'mood: good' in body


def test_templates_and_prompt(client, auth_headers):
    ts = client.get('/api/diary/templates', headers=AUTH).json()['data']
    assert any(t['key'] == 'evening' for t in ts) and all('body' in t for t in ts)
    p1 = client.get('/api/diary/prompt?date=2026-09-19', headers=AUTH).json()['data']
    p2 = client.get('/api/diary/prompt?date=2026-09-19', headers=AUTH).json()['data']
    assert p1['prompt'] == p2['prompt']


def test_requires_auth(client):
    assert client.get('/api/diary/entries').status_code == 401
    assert client.post('/api/diary/quick', json={'content': 'x'}).status_code == 401
    assert client.post('/api/diary/summary', json={'entry_date': '2026-09-19', 'content': 'x'}).status_code == 401
