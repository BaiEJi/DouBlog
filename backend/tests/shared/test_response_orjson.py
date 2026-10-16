"""orjson 全局序列化切换的一致性测试（FastJSONResponse / api_response / yamlfast）。

守护三件事：
1. 信封输出与旧 stdlib JSONResponse 语义一致（parse 等价、中文不转义、NaN 拒绝）
2. default=str 兜底：datetime 等非 JSON 类型不再 TypeError→500（旧实现的暗雷）
3. yamlfast 的 C loader 在 libyaml 可用时必须生效（防退化回纯 Python）
"""
import json
from datetime import datetime

import pytest
from fastapi.responses import JSONResponse

from app.shared.response import FastJSONResponse, api_response
from app.shared.yamlfast import YamlLoader, YamlDumper


def _render_legacy(content):
    """改造前 starlette JSONResponse 的渲染方式（对照基准）"""
    return JSONResponse(content).body


# ─── 信封语义一致性 ───────────────────────────────────────

PAYLOADS = [
    None,
    {'name': '中文不转义', '值': [1, 2.5, True, False, None]},
    {'嵌套': {'a': [{'b': '工具箱'}]}, '空': {}, '空数组': []},
    '纯字符串',
    42,
    [{'k%d' % i: 'v' * 50} for i in range(200)],      # 大列表（100KB 量级路径）
    {'emoji': '🌏🛠️', 'special': '"quoted" \\ backslash\nnewline\ttab'},
]

@pytest.mark.parametrize('data', PAYLOADS)
def test_envelope_parse_equivalent(data):
    """新旧渲染 parse 后语义等价（gzip/解析链路只看语义）"""
    envelope = {'success': True, 'code': 200, 'message': '操作成功', 'data': data}
    new_body = FastJSONResponse(envelope).body
    assert json.loads(new_body) == json.loads(_render_legacy(envelope))


def test_chinese_not_escaped():
    """中文/emoji 原样输出（旧 ensure_ascii=False 行为）"""
    body = FastJSONResponse({'data': '开发者工具箱'}).body
    assert '开发者工具箱'.encode('utf-8') in body
    assert b'\\u' not in body


def test_nan_serializes_to_null():
    """NaN/Infinity → null（orjson 默认；旧实现 allow_nan=False 抛 ValueError→500——
    行为变化：异常静默为 null，对单用户系统更温和，已在 backend.md 记录）"""
    body = FastJSONResponse({'data': float('nan')}).body
    assert json.loads(body)['data'] is None


def test_compact_separators_like_legacy():
    """紧凑分隔符与旧实现一致（无多余空格）"""
    body = FastJSONResponse({'a': 1, 'b': [1, 2]}).body
    assert b'"a":1' in body          # 冒号后无空格（与旧 separators=(",",":") 一致）
    assert b'"b":[1,2]' in body


def test_default_str_fallback_for_datetime():
    """非 JSON 类型经 default=str 兜底为文本（旧实现 TypeError→500）"""
    body = FastJSONResponse({'data': datetime(2026, 10, 16, 12, 0, 0)}).body
    assert b'2026-10-16' in body


# ─── api_response 行为 ────────────────────────────────────

def test_api_response_status_and_envelope():
    r = api_response({'x': 1}, 201, '已创建')
    assert r.status_code == 201
    body = json.loads(r.body)
    assert body == {'success': True, 'code': 201, 'message': '已创建', 'data': {'x': 1}}


def test_api_response_error_envelope():
    r = api_response(None, 400, '请求参数错误')
    assert r.status_code == 400
    assert json.loads(r.body)['success'] is False


# ─── yamlfast：C loader 生效与语义等价 ─────────────────────

def test_yaml_c_loader_active_when_available():
    import yaml
    if getattr(yaml, '__with_libyaml__', False):
        assert YamlLoader is yaml.CSafeLoader
        assert YamlDumper is yaml.CSafeDumper


def test_yaml_loader_semantics_match_safe_load():
    import yaml
    docs = [
        'a: 1\n中文: 值\n',
        'd: 2026-10-16\n列表: [1, 2.5, true, null]\n',
        'base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\n',
        '# 注释\nblock: |\n  两行\n',
    ]
    for doc in docs:
        assert yaml.load(doc, Loader=YamlLoader) == yaml.safe_load(doc)


def test_yaml_loader_error_type_compatible():
    """C loader 的解析错误仍是 yaml.YAMLError 子类（调用方 except 兼容）"""
    import yaml
    with pytest.raises(yaml.YAMLError):
        yaml.load('a: [1, 2', Loader=YamlLoader)
