"""原始配置解析与数据库读取共享同一无I/O合并规则。"""
import pytest
from app.todo.services import settings_from_raw


@pytest.mark.parametrize('raw', [None, '', '{invalid', '[]', 'null'])
def test_settings_from_raw_invalid_or_missing_uses_defaults(raw):
    settings = settings_from_raw(raw)
    assert settings['timezone'] == 'Asia/Shanghai'
    assert settings['auto_migrate'] is False
    assert settings['quadrant_labels'] == {'q1': '立即做', 'q2': '计划做', 'q3': '委派·批量', 'q4': '考虑删除'}


def test_settings_from_raw_replaces_known_top_level_fields_only():
    settings = settings_from_raw('{"timezone":"UTC","quadrant_labels":{"q1":"专注"},"unknown":123}')
    assert settings['timezone'] == 'UTC'
    assert settings['quadrant_labels'] == {'q1': '专注'}
    assert settings['auto_migrate'] is False
    assert 'unknown' not in settings
