"""
Skill 包解析：单文件（.md/.markdown/.txt）或 zip 压缩包 → 规格校验 + 描述提取 + 文件清单。

规格（Agent Skills 惯例）：
- 压缩包内必须**恰好一个** SKILL.md（位于根或单层子目录均可，多余层级取其路径）
- SKILL.md 需 YAML frontmatter，必含 name / description：
  name 小写字母/数字/连字符（≤64），description 非空（≤1024）
- 单文件宽松：无 frontmatter 也可导入（标题=文件名，摘要=首个非标题行）
- 安全防护：zip-slip（绝对路径 / `..`）、条目 ≤200、解压总量 ≤20MB、单文件 ≤5MB、
  上传本体 ≤10MB；`__MACOSX/`、`.git/`、`__pycache__/`、点文件为打包噪音自动忽略

复用：zipfile（标准库）+ PyYAML（既有依赖，practice 模块同源用法）——不重复造轮子。
"""

import io
import re
import zipfile
from pathlib import PurePosixPath

import yaml

from lizysdk.errors import ParamError

SKILL_ENTRY = 'SKILL.md'
NAME_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
MAX_NAME = 64
MAX_DESC = 1024
MAX_ENTRIES = 200
MAX_TOTAL = 20 * 1024 * 1024
MAX_FILE = 5 * 1024 * 1024
MAX_UPLOAD = 10 * 1024 * 1024
TEXT_STORE_LIMIT = 512 * 1024            # 文本预览入库上限（超过只存元数据）

TEXT_EXTS = {
    '.md', '.markdown', '.txt', '.text', '.rst', '.py', '.js', '.jsx', '.ts', '.tsx',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.csv', '.tsv',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.html', '.htm',
    '.css', '.scss', '.xml', '.svg', '.env', '.gitignore', '.editorconfig', '.lock',
}

IGNORE_SEGMENTS = {'__MACOSX', '.git', '__pycache__', '.idea', '.vscode', '.DS_Store'}
IGNORE_FILES = ('Thumbs.db',)

_FM_RE = re.compile(r'\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)\Z', re.S)


def split_frontmatter(text: str) -> tuple[dict | None, str]:
    """拆 YAML frontmatter：返回 (fm 字典或 None, 正文)；解析失败视作无 frontmatter"""
    m = _FM_RE.match(text)
    if not m:
        return None, text
    try:
        fm = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None, text
    if fm is None or not isinstance(fm, dict):
        return None, text
    return fm, m.group(2)


def _validate_spec(fm: dict):
    """校验 name/description 规格，返回 (name, description)；不合规抛 ParamError"""
    name = fm.get('name')
    desc = fm.get('description')
    if not isinstance(name, str) or not name.strip():
        raise ParamError(message='SKILL.md frontmatter 缺少 name（或不是字符串）')
    if not isinstance(desc, str) or not desc.strip():
        raise ParamError(message='SKILL.md frontmatter 缺少 description（或不是字符串）')
    name = name.strip()
    desc = desc.strip()
    if len(name) > MAX_NAME or not NAME_RE.match(name):
        raise ParamError(
            message=f'name 只能是小写字母/数字/连字符，且不超过 {MAX_NAME} 字符（当前：{name!r}）')
    if len(desc) > MAX_DESC:
        raise ParamError(message=f'description 不能超过 {MAX_DESC} 字符（当前 {len(desc)}）')
    return name, desc


def _is_text(path: str, data: bytes) -> bool:
    ext = PurePosixPath(path).suffix.lower()
    if ext in TEXT_EXTS:
        return True
    if ext:
        return False
    # 无扩展名：可 utf-8 解码即视为文本
    try:
        data.decode('utf-8')
        return True
    except UnicodeDecodeError:
        return False


def _safe_entry(name: str) -> str | None:
    """zip 条目安全化：拒绝 zip-slip；噪音条目（任意层级的 __MACOSX/.git 等）返回 None"""
    p = PurePosixPath(name.replace('\\', '/'))
    if p.is_absolute() or '..' in p.parts or (len(name) > 1 and name[1] == ':'):
        raise ParamError(message=f'压缩包含不安全路径：{name}')
    if any(seg in IGNORE_SEGMENTS for seg in p.parts):
        return None
    if p.name in IGNORE_FILES or p.name.startswith('._'):
        return None
    return str(p)


def parse_markdown_skill(filename: str, text: str) -> dict:
    """单文件导入（宽松）：有合规 frontmatter 走严格提取，否则文件名 + 首行摘要"""
    fm, body = split_frontmatter(text)
    if fm is not None and ('name' in fm or 'description' in fm):
        name, desc = _validate_spec(fm)
        return {'name': name, 'description': desc, 'content': text, 'files': []}
    # 宽松：标题 = 文件名去扩展；摘要 = 首个非空非标题行
    stem = PurePosixPath(filename).stem or '未命名技能'
    first = ''
    for line in body.splitlines():
        s = line.strip()
        if s.startswith('#'):
            continue                      # 跳过标题行
        s = s.lstrip('-*>+ ').strip()
        if s and not s.startswith(('---', '===', '!')):
            first = s
            break
    return {'name': stem[:MAX_TITLE_DRAFT], 'description': first[:200] or '（无描述）',
            'content': text, 'files': []}


MAX_TITLE_DRAFT = 100


def parse_zip_skill(data: bytes) -> dict:
    """zip 包导入（严格）：恰好一个 SKILL.md + 规格 frontmatter + 完整文件清单"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ParamError(message='不是有效的 zip 压缩包')

    entries: list[tuple[str, bytes]] = []
    total = 0
    for info in zf.infolist():
        if info.is_dir():
            continue
        norm = _safe_entry(info.filename)
        if norm is None:
            continue
        if len(entries) >= MAX_ENTRIES:
            raise ParamError(message=f'压缩包条目超过 {MAX_ENTRIES} 个')
        if info.file_size > MAX_FILE:
            raise ParamError(message=f'单文件超过 5MB：{norm}')
        total += info.file_size
        if total > MAX_TOTAL:
            raise ParamError(message='解压后总量超过 20MB')
        entries.append((norm, zf.read(info)))

    skill_paths = [p for p, _ in entries if p.rsplit('/', 1)[-1] == SKILL_ENTRY]
    if not skill_paths:
        raise ParamError(message='压缩包内未找到 SKILL.md（Agent Skills 规格要求）')
    if len(set(skill_paths)) > 1:
        raise ParamError(message=f'压缩包内有 {len(skill_paths)} 个 SKILL.md，请一个包一个技能')

    # 单一根目录前缀剥掉（skill-name/SKILL.md → SKILL.md），树展示更贴近技能目录本身
    paths = [p for p, _ in entries]
    first_segs = {p.split('/', 1)[0] for p in paths if '/' in p}
    strip_prefix = next(iter(first_segs)) if len(first_segs) == 1 and \
        all(p.startswith(next(iter(first_segs)) + '/') for p in paths) else ''
    def _strip(p):
        return p[len(strip_prefix) + 1:] if strip_prefix and p.startswith(strip_prefix + '/') else p

    skill_entry = next(p for p, _ in entries if p.rsplit('/', 1)[-1] == SKILL_ENTRY)
    try:
        skill_text = next(d for p, d in entries if p == skill_entry).decode('utf-8')
    except UnicodeDecodeError:
        raise ParamError(message='SKILL.md 必须是 UTF-8 编码')

    fm, _body = split_frontmatter(skill_text)
    if fm is None:
        raise ParamError(message='SKILL.md 缺少 YAML frontmatter（需 name 与 description）')
    name, desc = _validate_spec(fm)

    files = []
    for p, blob in sorted(entries, key=lambda e: e[0]):
        is_text = _is_text(p, blob)
        files.append({
            'path': _strip(p) or p,
            'size': len(blob),
            'is_text': is_text,
            'content': (blob.decode('utf-8', errors='replace')
                        if is_text and len(blob) <= TEXT_STORE_LIMIT else None),
            '_is_entry': p == skill_entry,
        })

    return {'name': name, 'description': desc, 'content': skill_text,
            'files': files, 'archive': data}


def parse_skill_upload(filename: str, data: bytes) -> dict:
    """上传入口分发：.zip → 严格包解析；.md/.markdown/.txt → 单文件宽松解析"""
    if len(data) > MAX_UPLOAD:
        raise ParamError(message='文件不能超过 10MB')
    lower = (filename or '').lower()
    if lower.endswith('.zip'):
        draft = parse_zip_skill(data)
        draft['archive_name'] = filename
        return draft
    if lower.endswith(('.md', '.markdown', '.txt')):
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            raise ParamError(message='文件必须是 UTF-8 编码')
        draft = parse_markdown_skill(filename, text)
        draft['archive_name'] = None
        return draft
    raise ParamError(message='仅支持 .md / .markdown / .txt 单文件或 .zip 压缩包')
