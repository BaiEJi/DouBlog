"""The portable document boundary; editor plugin fields survive round trips unchanged."""
import json
import re
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from lizysdk.errors import ParamError

MAX_BYTES = 10 * 1024 * 1024
METADATA_BYTES = 16 * 1024
MAX_ENVELOPE_BYTES = MAX_BYTES + METADATA_BYTES
MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES + METADATA_BYTES
MAX_NODES = 10000
MAX_SUMMARIES = 1000
MAX_DEPTH = 128
SCHEMA_VERSION = 1
FORMAT = 'doublog.mindmap'
UNSAFE_KEYS = frozenset(('__proto__', 'prototype', 'constructor'))
LAYOUTS = frozenset((
    'logicalStructure', 'logicalStructureLeft', 'mindMap', 'organizationStructure',
    'catalogOrganization', 'timeline', 'timeline2', 'fishbone', 'verticalTimeline',))


def invalid(message, **details):
    raise ParamError(message=message, details=details or None)


def positive_int(value, name='revision'):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 2147483647:
        invalid(f'{name} 必须是正整数', field=name)
    return value


def name_value(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
        invalid('导图名称必须为 1–200 个字符', field='name')
    return value.strip()


def mutation_value(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        invalid('mutation_id 必须为 1–128 个字符的唯一请求标识', field='mutation_id')
    return value


def json_bytes(value):
    try:
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        return raw.encode('utf-8')
    except (ValueError, TypeError, RecursionError, UnicodeEncodeError):
        invalid('数据必须为有限数值组成的有效 JSON，不能包含循环引用')


def default_document(name):
    return {
        'root': {'data': {'uid': str(uuid4()), 'text': name, 'expand': True}, 'children': []},
        'layout': 'logicalStructure', 'theme': {'template': 'default', 'config': {}},
    }


def _safe_url(value, image=False):
    if not isinstance(value, str):
        invalid('图片或链接地址必须是字符串')
    if not value:
        return
    if value != value.strip() or re.search(r'[\x00-\x20\x7f\\]', value):
        invalid('图片或链接地址包含非法空白或控制字符')
    if image and value.startswith('data:'):
        if not re.fullmatch(r'data:image/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}', value):
            invalid('仅允许 PNG/JPEG/GIF/WebP 的 base64 图片')
        return
    try:
        parsed = urlsplit(value)
    except ValueError:
        invalid('图片或链接地址格式无效')
    if value.startswith('//') or parsed.scheme.lower() not in ('http', 'https', '', 'mailto'):
        invalid('图片或链接地址协议不允许')
    if image and parsed.scheme.lower() == 'mailto':
        invalid('图片地址协议不允许')
    if not parsed.scheme and not value.startswith(('/', '#')):
        invalid('站内链接必须以 / 或 # 开头')
    if parsed.scheme.lower() in ('http', 'https') and not parsed.netloc:
        invalid('HTTP 地址必须包含域名')
    if image and unquote(parsed.path).lower().endswith(('.svg', '.svgz')):
        invalid('节点图片不支持 SVG/SVGZ，请使用位图')


def _validate_json_fields(document):
    """Vendor text is rendered through foreignObject when richText=true.

    Basic formatting is supplied by node style properties, so rich HTML and
    prototype keys are rejected at the persisted boundary, including summaries.
    """
    stack = [document]
    seen = set()
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if id(value) in seen:
                invalid('数据包含循环引用或重复对象')
            seen.add(id(value))
            for key, child in value.items():
                if key in UNSAFE_KEYS:
                    invalid('数据包含不安全的对象属性', field=key)
                if key == 'richText' and child not in (False, None):
                    invalid('本版本使用基础文本，不接受 richText HTML')
                if key == 'hyperlink':
                    _safe_url(child)
                if key == 'attachmentUrl':
                    _safe_url(child)
                if key in ('hyperlinkTitle', 'attachmentName'):
                    if not isinstance(child, str) or '<' in child or '>' in child:
                        invalid('链接和附件标题必须是普通文本，不能包含 XML 标签', field=key)
                if key == 'imgMap':
                    if not isinstance(child, dict):
                        invalid('imgMap 必须是图片地址映射对象')
                    for image_url in child.values():
                        _safe_url(image_url, image=True)
                if key == 'icon' and (not isinstance(child, list) or any(
                        not isinstance(icon, str) for icon in child)):
                    invalid('图标必须是字符串 ID 数组')
                if key in ('tag', 'tags'):
                    if not isinstance(child, list):
                        invalid('标签必须是数组')
                    for tag in child:
                        if not isinstance(tag, str) and not (
                            isinstance(tag, dict) and isinstance(tag.get('text'), str)
                            and ('style' not in tag or isinstance(tag['style'], dict))
                        ):
                            invalid('标签必须是字符串或包含 text 的对象')
                if key in ('image', 'backgroundImage') and child and not (key == 'backgroundImage' and child == 'none'):
                    _safe_url(child, image=True)
                stack.append(child)
        elif isinstance(value, list):
            if id(value) in seen:
                invalid('数据包含循环引用或重复对象')
            seen.add(id(value))
            stack.extend(value)


def validate_request_json(value):
    _validate_json_fields(value)
    encoded = json_bytes(value)
    # The document keeps its exact 10MiB limit; transport and portable identity
    # fields have independent, bounded budgets so a full valid map round-trips.
    carrier = next((value[key] for key in ('payload', 'envelope', 'document', 'operations', 'node', 'data')
                    if key in value), None)
    content_bytes = len(json_bytes(carrier)) if carrier is not None else 0
    if len(encoded) - content_bytes > METADATA_BYTES:
        invalid('请求封装元数据不能超过 16KiB', limit_metadata_bytes=METADATA_BYTES)


def validate_document(document):
    """Iterative traversal handles wide maps without recursion or quadratic scans."""
    if not isinstance(document, dict):
        invalid('document 必须是对象', field='document')
    _validate_json_fields(document)
    if not isinstance(document.get('layout'), str) or document['layout'] not in LAYOUTS:
        invalid('不支持的布局类型', field='document.layout', allowed=sorted(LAYOUTS))
    theme = document.get('theme')
    if not isinstance(theme, dict) or not isinstance(theme.get('template'), str) \
            or not isinstance(theme.get('config'), dict):
        invalid('theme 必须包含字符串 template 和对象 config', field='document.theme')
    if 'view' in document and not isinstance(document['view'], dict):
        invalid('view 必须是对象', field='document.view')
    root = document.get('root')
    stack, seen_objects, ids, references = [(root, 1)], set(), set(), []
    summary_ids, summary_count = set(), 0
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict) or not isinstance(node.get('data'), dict):
            invalid('每个节点必须包含 data 对象', field='document.root')
        if id(node) in seen_objects:
            invalid('节点存在循环引用或重复对象')
        seen_objects.add(id(node))
        if depth > MAX_DEPTH:
            invalid(f'节点深度不能超过 {MAX_DEPTH}', limit=MAX_DEPTH)
        data = node['data']
        uid = data.get('uid')
        if not isinstance(uid, str) or not uid.strip() or len(uid) > 128:
            invalid('节点 uid 必须是 1–128 个字符的字符串', field='uid')
        if uid in ids or uid in summary_ids:
            invalid('节点或概要 uid 重复（不允许循环父子关系）', uid=uid)
        ids.add(uid)
        if len(ids) > MAX_NODES:
            invalid(f'节点总数不能超过 {MAX_NODES}', limit=MAX_NODES)
        if not isinstance(data.get('text'), str) or len(data['text']) > 100000:
            invalid('节点 text 必须是不超过 100000 字符的字符串', uid=uid)
        if 'expand' in data and not isinstance(data['expand'], bool):
            invalid('节点 expand 必须是布尔值', uid=uid)
        for key in ('note', 'hyperlink', 'hyperlinkTitle', 'image', 'imageTitle'):
            if key in data and not isinstance(data[key], str):
                invalid(f'节点 {key} 必须是字符串', uid=uid)
        for key in ('tag', 'tags', 'icon'):
            if key in data and not isinstance(data[key], list):
                invalid(f'节点 {key} 必须是数组', uid=uid)
        for key in ('tag', 'tags'):
            for tag in data.get(key, []):
                if not isinstance(tag, str) and not (
                    isinstance(tag, dict) and isinstance(tag.get('text'), str)
                    and ('style' not in tag or isinstance(tag['style'], dict))
                ):
                    invalid('标签必须是字符串或包含 text 的对象', uid=uid)
        if any(not isinstance(icon, str) for icon in data.get('icon', [])):
            invalid('图标必须使用字符串 ID', uid=uid)
        children = node.get('children', [])
        if not isinstance(children, list):
            invalid('节点 children 必须是数组', uid=uid)
        targets = data.get('associativeLineTargets', [])
        if not isinstance(targets, list) or any(not isinstance(t, str) for t in targets):
            invalid('associativeLineTargets 必须是 uid 字符串数组', uid=uid)
        if len(set(targets)) != len(targets):
            invalid('关联线目标不能重复', uid=uid)
        references.extend((uid, target) for target in targets)
        # Legacy summaries can omit UID; supplied IDs share the whole map namespace.
        generalizations = data.get('generalization', [])
        if not isinstance(generalizations, (list, dict)):
            invalid('generalization 必须是对象或数组', uid=uid)
        for summary in generalizations if isinstance(generalizations, list) else [generalizations]:
            if not isinstance(summary, dict) or not isinstance(summary.get('text'), str):
                invalid('每个概要必须是包含 text 字符串的对象', uid=uid)
            summary_count += 1
            if summary_count > MAX_SUMMARIES:
                invalid(f'概要总数不能超过 {MAX_SUMMARIES}', limit=MAX_SUMMARIES)
            if 'uid' in summary:
                summary_uid = summary['uid']
                if not isinstance(summary_uid, str) or not summary_uid.strip() or len(summary_uid) > 128:
                    invalid('概要 uid 必须是 1–128 个字符的字符串', field='generalization.uid')
                if summary_uid in ids or summary_uid in summary_ids:
                    invalid('节点或概要 uid 重复', uid=summary_uid)
                summary_ids.add(summary_uid)
            summary_range = summary.get('range')
            if summary_range is not None and (
                not isinstance(summary_range, list) or len(summary_range) != 2
                or any(isinstance(bound, bool) or not isinstance(bound, int) for bound in summary_range)
                or not 0 <= summary_range[0] <= summary_range[1] < len(children)
            ):
                invalid('概要 range 必须为有效子节点区间 [start,end]，或 null',
                        uid=uid, field='generalization.range')
        stack.extend((child, depth + 1) for child in reversed(children))
    for source, target in references:
        if target not in ids:
            invalid('关联线引用了不存在的节点', uid=source, target=target)
        if source == target:
            invalid('关联线不能引用节点自身', uid=source)
    # Validate arbitrary plugin fields as JSON as well, reject non-finite values.
    payload = json_bytes(document)
    if len(payload) > MAX_BYTES:
        invalid('document 不能超过 10MiB', limit_bytes=MAX_BYTES)
    return document, len(ids)


def validate_envelope(payload):
    if not isinstance(payload, dict):
        invalid('payload 必须是导出的 JSON 对象', field='payload')
    if payload.get('format') != FORMAT:
        invalid(f'导入 format 必须是 {FORMAT}', field='format')
    if isinstance(payload.get('schema_version'), bool) or payload.get('schema_version') != SCHEMA_VERSION:
        invalid('不支持的 schema_version，仅支持版本 1', field='schema_version')
    for field in ('id', 'revision'):
        positive_int(payload.get(field), field)
    name_value(payload.get('name'))
    if 'workspace_id' not in payload or 'post_id' not in payload:
        invalid('导入数据缺少 workspace_id 或 post_id')
    positive_int(payload['workspace_id'], 'workspace_id')
    if payload['post_id'] is not None:
        positive_int(payload['post_id'], 'post_id')
    validate_document(payload.get('document'))
    encoded = json_bytes(payload)
    if len(encoded) - len(json_bytes(payload['document'])) > METADATA_BYTES:
        invalid('导入信封元数据不能超过 16KiB', limit_metadata_bytes=METADATA_BYTES)
    if len(encoded) > MAX_ENVELOPE_BYTES:
        invalid('导入信封不能超过 10MiB + 16KiB', limit_bytes=MAX_ENVELOPE_BYTES)
    return payload
