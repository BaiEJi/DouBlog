"""服务层公共工具:事件日志、设置读取。"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from ..models import AppSetting, TaskEvent
from app.shared.timeutil import now_utc, uuid7

_LOCAL_TZ = "Asia/Shanghai"  # 固定上海时间

DEFAULT_SETTINGS: dict[str, Any] = {
    "timezone": _LOCAL_TZ,
    "quadrant_labels": {"q1": "立即做", "q2": "计划做", "q3": "委派·批量", "q4": "考虑删除"},
    "quadrant_subtitles": {
        "q1": "重要且紧急 · 今天必须完成",
        "q2": "重要不紧急 · 排进日程",
        "q3": "紧急不重要 · 尽量压缩",
        "q4": "不紧急不重要 · 质疑它的存在",
    },
    "auto_migrate": False,
    "auto_urgent_days": 2,
    "migration_intervene_threshold": 3,
    "quadrant_soft_limit": 8,
    "day_start_hour": 0,
    # 消息推送渠道(共享同一配置结构:enabled + 各渠道自有字段;email 已支持,其余预留待接入)
    "notifications": {
        "channels": {
            "email": {
                "enabled": False,
                "smtp_host": "",
                "smtp_port": 465,
                "smtp_ssl": True,
                "username": "",
                "password": "",
                "sender": "",
                "recipient": "",
            },
            "apk": {"enabled": False},
            "chrome": {"enabled": False},
            "chatbot": {"enabled": False},
            "other": {"enabled": False},
        }
    },
}

_SETTING_KEY = "app"

# 已解析设置缓存:(存储原始 JSON 串 → 解析结果 dict)。设置行不变时免重复 json.loads;
# 返回值做拷贝(顶层 + 嵌套 dict),调用方(save_settings)可安全原地改。
_SETTINGS_PARSE_CACHE: tuple[str | None, dict] = (None, {})


def _stored_settings(raw: str | None) -> dict:
    global _SETTINGS_PARSE_CACHE
    if raw == _SETTINGS_PARSE_CACHE[0]:
        return _SETTINGS_PARSE_CACHE[1]
    try:
        stored = json.loads(raw) if raw else {}
        if not isinstance(stored, dict):
            stored = {}
    except Exception:
        stored = {}
    _SETTINGS_PARSE_CACHE = (raw, stored)
    return stored


def get_settings(session: Session) -> dict[str, Any]:
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_SETTINGS.items()}
    row = session.get(AppSetting, _SETTING_KEY)
    if row:
        stored = _stored_settings(row.value)
        for k, v in stored.items():
            if k in merged:
                merged[k] = v
    return merged


def save_settings(session: Session, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_settings(session)
    for k, v in patch.items():
        if k in DEFAULT_SETTINGS and v is not None:
            current[k] = v
    row = session.get(AppSetting, _SETTING_KEY)
    if row is None:
        row = AppSetting(key=_SETTING_KEY, value="{}")
        session.add(row)
    row.value = json.dumps(current, ensure_ascii=False)
    return current


def log_event(session: Session, task_id: str, event_type: str, payload: dict | None = None) -> None:
    session.add(
        TaskEvent(
            id=uuid7(),
            task_id=task_id,
            event_type=event_type,
            payload=json.dumps(payload, ensure_ascii=False) if payload else None,
            created_at=now_utc(),
        )
    )
