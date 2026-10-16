"""devtoolbox 模块测试：哈希 / 字符集互转 / JSON⇄YAML / 二维码 / 鉴权与上限。

纯计算端点，无外部依赖；正确性对照标准库（hashlib/hmac/codecs）与 segno 输出形态。
"""
import base64
import hashlib
import hmac as hmac_mod

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()}


def _post(client, path, json=None, expect=200, headers=AUTH):
    r = client.post(f'/api/devtoolbox{path}', json=json, headers=headers)
    assert r.status_code == expect, r.json()
    body = r.json()
    if expect == 200:
        assert body['success'] is True
        return body['data']
    return body


# ─── 鉴权 ────────────────────────────────────────────────

def test_requires_auth(client):
    """无凭据访问全部端点 → 401（信封错误，非 FastAPI 裸 401）"""
    for path, payload in [
        ('/hash', {'text': 'x', 'algorithm': 'md5'}),
        ('/charset/convert', {'text': 'x', 'from_charset': 'utf-8', 'to_charset': 'gbk'}),
        ('/yaml/convert', {'direction': 'json2yaml', 'content': '1'}),
        ('/qrcode', {'content': 'x'}),
    ]:
        r = client.post(f'/api/devtoolbox{path}', json=payload)
        assert r.status_code == 401, (path, r.status_code)


def test_capabilities(client):
    data = client.get('/api/devtoolbox/capabilities', headers=AUTH).json()['data']
    assert 'md5' in data['hash_algorithms']
    assert 'gbk' in data['charsets']
    assert data['max_qrcode_chars'] == 2000


# ─── 哈希 / HMAC ─────────────────────────────────────────

@pytest.mark.parametrize('algorithm', [
    'md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512',
    'sha3_256', 'sha3_512', 'blake2b', 'blake2s',
])
def test_hash_matches_stdlib(client, algorithm):
    data = _post(client, '/hash', {'text': '你好 world', 'algorithm': algorithm})
    expected = hashlib.new(algorithm, '你好 world'.encode('utf-8')).hexdigest()
    assert data['hex'] == expected
    assert data['hmac'] is False
    assert data['algorithm'] == algorithm


def test_hash_known_vector(client):
    data = _post(client, '/hash', {'text': 'hello', 'algorithm': 'md5'})
    assert data['hex'] == '5d41402abc4b2a76b9719d911017c592'


@pytest.mark.parametrize('algorithm', ['md5', 'sha1', 'sha256', 'sha512'])
def test_hmac_matches_stdlib(client, algorithm):
    data = _post(client, '/hash', {'text': 'The quick brown fox', 'algorithm': algorithm,
                                   'hmac_key': 'key'})
    expected = hmac_mod.new(b'key', b'The quick brown fox', algorithm).hexdigest()
    assert data['hex'] == expected
    assert data['hmac'] is True


def test_hash_unknown_algorithm(client):
    body = _post(client, '/hash', {'text': 'x', 'algorithm': 'sha999'}, expect=400)
    assert '不支持的算法' in body['message']


def test_hmac_unsupported_algorithm(client):
    body = _post(client, '/hash', {'text': 'x', 'algorithm': 'sha3_256', 'hmac_key': 'k'}, expect=400)
    assert 'HMAC 不支持' in body['message']


def test_hash_rejects_oversize(client):
    body = _post(client, '/hash', {'text': 'x' * (1024 * 1024 + 10), 'algorithm': 'md5'}, expect=400)
    assert '1MB' in body['message']


# ─── 字符集互转（乱码修复）────────────────────────────────

def test_charset_gbk_roundtrip(client):
    """语义：text --encode(from)--> 中间字节(hex) --decode(to)--> result"""
    data = _post(client, '/charset/convert',
                 {'text': '你好', 'from_charset': 'gbk', 'to_charset': 'gbk'})
    assert data['hex'] == 'c4 e3 ba c3'
    assert data['bytes'] == 4
    assert data['result'] == '你好'


def test_charset_mojibake_fix(client):
    """UTF-8 被按 latin-1 误解的乱码还原：ä½ å¥½ → 你好"""
    mojibake = '你好'.encode('utf-8').decode('latin-1')
    data = _post(client, '/charset/convert',
                 {'text': mojibake, 'from_charset': 'latin-1', 'to_charset': 'utf-8'})
    assert data['result'] == '你好'


def test_charset_unsupported(client):
    body = _post(client, '/charset/convert',
                 {'text': 'x', 'from_charset': 'utf-8', 'to_charset': 'rot13'}, expect=400)
    assert '不支持的字符集' in body['message']


def test_charset_unencodable(client):
    """gbk 无法编码 emoji → 400 且提示可换 gb18030"""
    body = _post(client, '/charset/convert',
                 {'text': '🙂', 'from_charset': 'gbk', 'to_charset': 'utf-8'}, expect=400)
    assert 'gb18030' in body['message']


def test_charset_undecodable(client):
    """0xFF 字节无法按 utf-8 解出 → 400"""
    body = _post(client, '/charset/convert',
                 {'text': '\xff', 'from_charset': 'latin-1', 'to_charset': 'utf-8'}, expect=400)
    assert '解释字节' in body['message']


# ─── JSON ⇄ YAML ─────────────────────────────────────────

def test_yaml_json2yaml_roundtrip(client):
    src = '{"名称": "工具箱", "数量": 30, "嵌套": {"开": true, "列表": [1, 2, 3]}}'
    data = _post(client, '/yaml/convert', {'direction': 'json2yaml', 'content': src})
    out = data['result']
    assert '名称: 工具箱' in out          # allow_unicode：中文不转义
    assert '开: true' in out
    back = _post(client, '/yaml/convert', {'direction': 'yaml2json', 'content': out})
    import json
    assert json.loads(back['result']) == json.loads(src)


def test_yaml_keeps_key_order(client):
    data = _post(client, '/yaml/convert', {'direction': 'json2yaml',
                                           'content': '{"z": 1, "a": 2}'})
    assert data['result'].index('z:') < data['result'].index('a:')


def test_yaml2json_date_serialized(client):
    data = _post(client, '/yaml/convert', {'direction': 'yaml2json', 'content': 'd: 2026-10-16'})
    assert '2026-10-16' in data['result']   # date → 字符串


def test_yaml2json_empty(client):
    data = _post(client, '/yaml/convert', {'direction': 'yaml2json', 'content': ''})
    assert data['result'].strip() == '{}'


def test_yaml_invalid_json(client):
    body = _post(client, '/yaml/convert', {'direction': 'json2yaml', 'content': '{bad'}, expect=400)
    assert 'JSON 解析失败' in body['message']


def test_yaml_invalid_yaml(client):
    body = _post(client, '/yaml/convert',
                 {'direction': 'yaml2json', 'content': 'a: [1, 2'}, expect=400)
    assert 'YAML 解析失败' in body['message']


def test_yaml_bad_direction(client):
    body = _post(client, '/yaml/convert', {'direction': 'nope', 'content': '1'}, expect=400)
    assert 'direction' in body['message']


# ─── 二维码 ──────────────────────────────────────────────

def test_qrcode_output_forms(client):
    data = _post(client, '/qrcode', {'content': 'https://example.com'})
    assert data['svg'].lstrip().startswith('<?xml')
    assert '<svg' in data['svg']
    assert data['png_data_url'].startswith('data:image/png;base64,')
    base64.b64decode(data['png_data_url'].split(',', 1)[1])     # 可解码
    assert data['version'] >= 1


def test_qrcode_empty_rejected(client):
    body = _post(client, '/qrcode', {'content': '   '}, expect=400)
    assert '不能为空' in body['message']


def test_qrcode_bad_ecc(client):
    body = _post(client, '/qrcode', {'content': 'x', 'ecc': 'z'}, expect=400)
    assert '纠错级别' in body['message']


def test_qrcode_oversize_rejected(client):
    body = _post(client, '/qrcode', {'content': 'x' * 2001}, expect=400)
    assert '2000' in body['message']


def test_qrcode_params_clamped(client):
    """scale/border 越界钳到安全区间，不报错"""
    data = _post(client, '/qrcode', {'content': 'x', 'scale': 999, 'border': -5, 'ecc': 'h'})
    assert '<svg' in data['svg']
