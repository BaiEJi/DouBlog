"""
开发者工具箱 API：哈希 / 字符集互转 / JSON⇄YAML / 二维码（全部 require_basic，DouBlog 信封）。

| HTTP | 路径 | 能力 |
|---|---|---|
| POST | /hash | MD5/SHA-1/SHA-2/SHA-3/BLAKE 家族 + HMAC（hex 摘要） |
| POST | /charset/convert | 文本按 from 编码为字节再按 to 解码（乱码修复），附 hex 视图 |
| POST | /yaml/convert | JSON⇄YAML（PyYAML safe 加载，保留键序与 Unicode） |
| POST | /qrcode | 生成二维码（SVG 字符串 + PNG data URL，segno） |

全部为同步 def（计算量在 1MB 量级输入下毫秒级完成，FastAPI 自动扔线程池）。
"""
import base64
import codecs
import hashlib
import hmac
import io
import json

import segno
import yaml
from fastapi import APIRouter, Depends
from lizysdk.errors import ParamError
from pydantic import BaseModel

from app.shared.auth import require_basic
from app.shared.response import api_response

router = APIRouter(prefix='/api/devtoolbox', tags=['devtoolbox'],
                   dependencies=[Depends(require_basic)])

#: 输入上限（纯计算端点防滥用；超过提示走本地工具）
MAX_TEXT_BYTES = 1 * 1024 * 1024
MAX_QRCODE_CHARS = 2000

#: hashlib.new 支持的算法（白名单，防任意算法名注入）
HASH_ALGORITHMS = ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512',
                   'sha3_256', 'sha3_512', 'blake2b', 'blake2s')
#: HMAC 支持的算法（hmac.new 文档所列）
HMAC_ALGORITHMS = ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512')

#: 字符集互转白名单（乱码修复常见场景）
CHARSETS = ('utf-8', 'gbk', 'gb18030', 'big5', 'shift_jis', 'euc-kr',
            'latin-1', 'windows-1252', 'utf-16')


class _HashBody(BaseModel):
    text: str
    algorithm: str
    hmac_key: str = ''


class _CharsetBody(BaseModel):
    text: str
    from_charset: str
    to_charset: str


class _YamlBody(BaseModel):
    direction: str          # 'json2yaml' | 'yaml2json'
    content: str


class _QrcodeBody(BaseModel):
    content: str
    scale: int = 6          # 每模块像素（PNG）/ 单位（SVG）
    border: int = 2         # 静区模块数
    ecc: str = 'm'          # 纠错级别 l/m/q/h


def _guard_size(text: str, what: str = '输入'):
    if len(text.encode('utf-8')) > MAX_TEXT_BYTES:
        raise ParamError(message=f'{what}超过 1MB 上限——请改用本地工具处理')


@router.get('/capabilities')
def get_capabilities():
    """前端能力声明：算法 / 字符集 / 上限（页面选项据此渲染，保持前后端一致）"""
    return api_response({
        'hash_algorithms': HASH_ALGORITHMS,
        'hmac_algorithms': HMAC_ALGORITHMS,
        'charsets': CHARSETS,
        'max_text_bytes': MAX_TEXT_BYTES,
        'max_qrcode_chars': MAX_QRCODE_CHARS,
    })


@router.post('/hash')
def compute_hash(body: _HashBody):
    """哈希 / HMAC：UTF-8 字节摘要（hex 小写）。带 hmac_key 时走 HMAC 模式。"""
    _guard_size(body.text)
    algorithm = body.algorithm.lower()
    data = body.text.encode('utf-8')
    try:
        if body.hmac_key:
            if algorithm not in HMAC_ALGORITHMS:
                raise ParamError(message=f'HMAC 不支持 {algorithm}（可选：{" / ".join(HMAC_ALGORITHMS)}）')
            digest = hmac.new(body.hmac_key.encode('utf-8'), data, algorithm).hexdigest()
        else:
            if algorithm not in HASH_ALGORITHMS:
                raise ParamError(message=f'不支持的算法 {algorithm}（可选：{" / ".join(HASH_ALGORITHMS)}）')
            digest = hashlib.new(algorithm, data).hexdigest()
    except ValueError as e:      # hashlib.new 对未知算法
        raise ParamError(message=f'不支持的算法：{e}') from e
    return api_response({'algorithm': algorithm, 'hmac': bool(body.hmac_key), 'hex': digest})


@router.post('/charset/convert')
def charset_convert(body: _CharsetBody):
    """乱码修复：text --encode(from)--> bytes --decode(to)--> 结果。

    典型场景：UTF-8 内容被按 latin-1 误解码成 "ä½ å¥½"，
    提交 from=latin-1 / to=utf-8 即还原。同时返回字节 hex 供核对。
    """
    _guard_size(body.text)
    src, dst = body.from_charset.lower(), body.to_charset.lower()
    for name in (src, dst):
        if name not in CHARSETS:
            raise ParamError(message=f'不支持的字符集 {name}（可选：{" / ".join(CHARSETS)}）')
    try:
        raw = body.text.encode(src, errors='strict')
    except UnicodeEncodeError as e:
        raise ParamError(message=f'无法用 {src} 编码该文本（{e}）——换 gb18030/utf-8 试试') from e
    try:
        fixed = raw.decode(dst, errors='strict')
    except UnicodeDecodeError as e:
        raise ParamError(message=f'无法用 {dst} 解释字节（{e}）——检查方向是否反了') from e
    return api_response({
        'from': src, 'to': dst,
        'result': fixed,
        'hex': raw.hex(' '),          # 每字节分组的小写 hex
        'bytes': len(raw),
    })


@router.post('/yaml/convert')
def yaml_convert(body: _YamlBody):
    """JSON ⇄ YAML（safe 模式：不实例化任意对象；date/datetime 序列化为字符串）。"""
    _guard_size(body.content, '内容')
    if body.direction == 'json2yaml':
        try:
            data = json.loads(body.content)
        except json.JSONDecodeError as e:
            raise ParamError(message=f'JSON 解析失败：第 {e.lineno} 行第 {e.colno} 列——{e.msg}') from e
        result = yaml.safe_dump(data, allow_unicode=True, sort_keys=False,
                                default_flow_style=False, width=100)
        return api_response({'result': result, 'direction': body.direction})
    if body.direction == 'yaml2json':
        try:
            data = yaml.safe_load(body.content)
        except yaml.YAMLError as e:
            raise ParamError(message=f'YAML 解析失败：{e}') from e
        if data is None:
            data = {}
        result = json.dumps(data, ensure_ascii=False, indent=2, default=str)
        return api_response({'result': result, 'direction': body.direction})
    raise ParamError(message='direction 仅支持 json2yaml / yaml2json')


@router.post('/qrcode')
def make_qrcode(body: _QrcodeBody):
    """二维码生成：SVG 字符串（自适配矢量）+ PNG data URL（位图预览/下载）。"""
    if not body.content.strip():
        raise ParamError(message='内容不能为空')
    if len(body.content) > MAX_QRCODE_CHARS:
        raise ParamError(message=f'内容超过 {MAX_QRCODE_CHARS} 字符（纠错级别越高容量越小）')
    ecc = body.ecc.lower()
    if ecc not in ('l', 'm', 'q', 'h'):
        raise ParamError(message='纠错级别仅支持 l/m/q/h')
    try:
        qr = segno.make(body.content, error=ecc)
    except ValueError as e:
        raise ParamError(message=f'内容超出二维码容量：{e}') from e
    scale = max(1, min(body.scale, 32))
    border = max(0, min(body.border, 10))
    svg_buf = io.BytesIO()      # segno 的 SVG 写出器写 bytes，必须用 BytesIO
    qr.save(svg_buf, kind='svg', scale=scale, border=border)
    png_buf = io.BytesIO()
    qr.save(png_buf, kind='png', scale=scale, border=border)
    data_url = 'data:image/png;base64,' + base64.b64encode(png_buf.getvalue()).decode('ascii')
    return api_response({
        'svg': svg_buf.getvalue().decode('utf-8'),
        'png_data_url': data_url,
        'version': qr.version,
        'ecc': ecc,
    })
