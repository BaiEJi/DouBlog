"""固定合成中英语料、导入预算和慢速/超大响应测试；不访问外网。"""
import io
import json

import pytest
from app.blog.bookmarks import fetcher, transfer


@pytest.mark.parametrize('body,tokens', [
    ('<article><h1>中文标题</h1><p>中文正文，保留这些字。</p></article>', ['# 中文标题', '中文正文']),
    ('<main><h2>English article</h2><p>Keep this paragraph.</p><ul><li>Outer<ul><li>Inner</li></ul></li></ul></main>', ['## English article', 'Keep this paragraph.', 'Outer', 'Inner']),
    ('<article><table><tr><th>列一</th><th>列二</th></tr><tr><td>A</td><td>B</td></tr></table></article>', ['列一', '列二', '|', 'A', 'B']),
    ('<article><pre><code class="language-python">print("``` literal")\n  keep_indent()</code></pre></article>', ['````python', '``` literal', '  keep_indent()']),
    ('<article><p>2 &lt;= i &lt;= 10; x<sup>2</sup> and H<sub>2</sub>O.</p><a href="/relative">链接</a></article>', ['2 <= i <= 10', '^2^', '~2~', 'https://example.org/relative']),
])
def test_fixed_html_corpus_preserves_structure(body, tokens):
    navigation = '<nav>' + '<a href="/noise">导航噪声</a>' * 100 + '</nav>'
    source = f'<html><body>{navigation}{body}<footer>页脚噪声</footer></body></html>'
    markdown = fetcher.extract_content(source, 'https://example.org/a/b')
    for token in tokens:
        assert token in markdown, (token, markdown)
    assert '导航噪声' not in markdown and '页脚噪声' not in markdown
    assert isinstance(fetcher.extract_content(source, 'https://example.org', adapter='legacy'), str)


def test_bookmark_import_preflight_writes_nothing_and_budget_rejects(client, app, monkeypatch):
    payload = {'items': [{'url': 'https://example.org/one', 'title': '一条'}]}
    raw = json.dumps(payload).encode()
    result = client.post('/api/bookmarks/import?dry_run=true', files={'file': ('bookmarks.json', io.BytesIO(raw), 'application/json')})
    assert result.status_code == 200, result.text
    assert result.json()['data']['imported'] == 1
    assert client.get('/api/bookmarks/items').json()['data']['total'] == 0
    accepted = client.post('/api/bookmarks/import', files={'file': ('bookmarks.json', io.BytesIO(raw), 'application/json')})
    assert accepted.status_code == 200 and accepted.json()['data']['imported'] == 1
    monkeypatch.setattr(transfer, 'IMPORT_MAX_BYTES', 10)
    rejected = client.post('/api/bookmarks/import', files={'file': ('big.json', io.BytesIO(raw), 'application/json')})
    assert rejected.status_code == 400
    assert client.get('/api/bookmarks/items').json()['data']['total'] == 1


@pytest.mark.parametrize('category', [{'id': []}, {'id': 'one', 'parent_id': {}}, {'id': 'one', 'name': []}])
def test_import_rejects_malformed_categories_without_partial_writes(client, category):
    raw = json.dumps({'categories': [category], 'items': [{'url': 'https://example.org/safe'}]}).encode()
    response = client.post('/api/bookmarks/import', files={'file': ('bad.json', io.BytesIO(raw), 'application/json')})
    assert response.status_code == 400, response.text
    assert client.get('/api/bookmarks/items').json()['data']['total'] == 0


def test_read_budget_and_total_deadline_are_explicit(monkeypatch):
    class Response:
        encoding = 'utf-8'
        raw = None
        def iter_content(self, chunk_size):
            yield b'12345'; yield b'67890'
    with pytest.raises(fetcher.FetchError, match='超过'):
        fetcher._read_limited(Response(), 8)
    monkeypatch.setattr(fetcher.time, 'monotonic', lambda: 20)
    with pytest.raises(fetcher.FetchError, match='总期限'):
        fetcher._read_limited(Response(), 100, deadline=10)
