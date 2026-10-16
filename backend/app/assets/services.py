"""
资产库服务层：变量提取 / 标签规范化 / 字段校验 / 版本快照。

变量约定：正文里的 `{{name}}`（name 以字母或下划线开头，可含数字/点/连字符），
保存时服务端提取去重（保持出现顺序）——与日记字数同理，别信任前端计数。
"""

import re

from lizysdk.errors import ParamError

from app.assets.models import KINDS, AssetItem, AssetVersion

_VAR_RE = re.compile(r'\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}')

MAX_TAGS = 20
MAX_TAG_LEN = 32
MAX_TITLE_LEN = 200
MAX_SUMMARY_LEN = 500


def extract_variables(content: str) -> list[str]:
    """提取正文中的 {{变量}} 名列表（去重，保持首次出现顺序）"""
    seen: list[str] = []
    for name in _VAR_RE.findall(content or ''):
        if name not in seen:
            seen.append(name)
    return seen


def normalize_tags(raw) -> list[str]:
    """标签规范化：字符串列表 → 去空白/去空/去重（保序）；超限报错"""
    if raw is None:
        return []
    if not isinstance(raw, (list, tuple)):
        raise ParamError(message='tags 必须为字符串数组')
    out: list[str] = []
    for t in raw:
        if not isinstance(t, str):
            raise ParamError(message='tags 必须为字符串数组')
        t = t.strip()
        if not t:
            continue
        if '"' in t or '\\' in t:
            raise ParamError(message='标签不能包含引号或反斜杠')
        if len(t) > MAX_TAG_LEN:
            raise ParamError(message=f'单个标签长度不能超过{MAX_TAG_LEN}个字符')
        if t not in out:
            out.append(t)
    if len(out) > MAX_TAGS:
        raise ParamError(message=f'标签数量不能超过{MAX_TAGS}个')
    return out


def validate_item_payload(data: dict, partial: bool = False) -> dict:
    """
    校验资产字段，返回规范化 dict。

    partial=True 时仅校验出现的字段（PUT）；kind/title/summary/content/tags
    属于「内容类」，变更会触发版本快照（是否真的变由调用方比对旧值）。
    """
    out: dict = {}
    keys = ('kind', 'title', 'summary', 'content', 'tags')
    if partial:
        keys = tuple(k for k in keys if k in data)

    if 'kind' in keys:
        kind = data.get('kind')
        if kind not in KINDS:
            raise ParamError(message=f'kind 必须是: {", ".join(KINDS)}')
        out['kind'] = kind

    if 'title' in keys:
        title = (data.get('title') or '').strip() if isinstance(data.get('title'), str) else ''
        if not title:
            raise ParamError(message='标题不能为空')
        if len(title) > MAX_TITLE_LEN:
            raise ParamError(message=f'标题长度不能超过{MAX_TITLE_LEN}个字符')
        out['title'] = title

    if 'summary' in keys:
        summary = data.get('summary')
        if summary is not None and not isinstance(summary, str):
            raise ParamError(message='summary 必须为字符串')
        if summary:
            summary = summary.strip()
            if len(summary) > MAX_SUMMARY_LEN:
                raise ParamError(message=f'摘要长度不能超过{MAX_SUMMARY_LEN}个字符')
        out['summary'] = summary or None

    if 'content' in keys:
        content = data.get('content')
        if not isinstance(content, str) or not content.strip():
            raise ParamError(message='正文不能为空')
        out['content'] = content

    if 'tags' in keys:
        out['tags'] = normalize_tags(data.get('tags'))

    return out


def snapshot_version(item: AssetItem, note: str | None = None) -> AssetVersion:
    """按当前条目内容创建下一版快照（调用方负责 add + 递增 item.version）"""
    return AssetVersion(
        item_id=item.id,
        version=item.version,
        title=item.title,
        summary=item.summary,
        content=item.content,
        note=(note or '').strip() or None,
    )


def content_changed(item: AssetItem, patch: dict) -> bool:
    """内容类字段（触发版本快照的）是否有实际变化（只比对 patch 里出现的键）"""
    return any(k in patch and patch[k] != getattr(item, k)
               for k in ('title', 'summary', 'content'))
