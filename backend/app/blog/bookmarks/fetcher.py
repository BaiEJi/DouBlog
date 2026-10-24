"""bookmarks 网络与 URL 工具层（纯函数，不落库；异常收敛为 FetchError 分类文案）。

- normalize_url：URL 规范化（小写 host / 去默认端口 / 去 fragment / 去 utm_* 追踪参数）
- fetch_meta：抓页面元信息（title / description / og:site_name / favicon），限 2MB
- fetch_snapshot：抓页面正文并转 Markdown（启发式抽取，规范决策不引 readability/html2text，
  与 practice 抓题同口径的"简单正则"策略；快照是离线阅读的 best-effort 产物）
- check_url：死链检测（HEAD，受限码回退 GET；<400 或 401/403/405/429 视为可达）

网络异常一律收敛为 FetchError（message 直接展示给用户），原文进 warning 日志；
本模块不持有任何可变全局状态（无缓存——元信息/快照每次现抓）。
"""
from __future__ import annotations

import html as html_mod
import re
import time
import urllib.parse
from html.parser import HTMLParser
from typing import Any, Optional

import requests

from app.shared.modules import mod_logger

_log = mod_logger("blog")

UA = "Mozilla/5.0 (compatible; DouBookmarks/1.0)"
FETCH_TIMEOUT = (5, 10)          # 连接 5s / 读取 10s
CHECK_TIMEOUT = 8
META_LIMIT = 2 * 1024 * 1024     # 元信息 2MB 上限
SNAPSHOT_LIMIT = 3 * 1024 * 1024  # 快照 3MB 上限
SNAPSHOT_MAX_CHARS = 200_000     # 快照 Markdown 长度上限（防超大页拖垮库）
FETCH_TOTAL_SECONDS = 20

#: 视为"可达"的受限响应码：需登录/防爬/方法受限，链接本身没死
_REACHABLE_CODES = {401, 403, 405, 429}


class FetchError(Exception):
    """抓取失败（网络/非 HTML 等），message 直接展示给用户。"""


def _net_error(what: str, e: Exception) -> FetchError:
    if isinstance(e, requests.Timeout):
        reason = "网络超时"
    elif isinstance(e, requests.ConnectionError):
        reason = "无法连接"
    elif isinstance(e, requests.TooManyRedirects):
        reason = "重定向过多"
    else:
        reason = "请求异常"
    _log.warning("%s失败: %s: %s", what, type(e).__name__, e)
    return FetchError(f"{what}失败: {reason}")


# ─── URL 规范化 ─────────────────────────────────────────────

_TRACKING_PREFIXES = ("utm_",)


def normalize_url(url: str) -> str:
    """URL 规范化：查重与重复检测的统一口径。

    - 无 scheme 补 https://；非 http(s)（mailto: 等）原样返回
    - host 小写、去默认端口（80/443）、去 fragment
    - 去路径尾部多余 /（根路径保留）、按参数名前缀剥 utm_* 追踪参数（保序）
    """
    u = (url or "").strip()
    if not u:
        return u
    # 已带 scheme（mailto: 等非 http(s)）原样返回；裸域名（无 scheme）补 https://
    m = re.match(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):(//)?", u)
    if m and not m.group(2):
        return u
    if not m:
        u = "https://" + u
    parts = urllib.parse.urlsplit(u)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return u
    host = (parts.hostname or "").lower()
    try:
        port = parts.port
    except ValueError:
        port = None
    default = 80 if scheme == "http" else 443
    netloc = host if not port or port == default else f"{host}:{port}"
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/") or "/"
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not k.lower().startswith(_TRACKING_PREFIXES)]
    query = urllib.parse.urlencode(kept)
    return urllib.parse.urlunsplit((scheme, netloc, path, query, ""))


def domain_of(url: str) -> str:
    """取 URL 的注册域展示形式（host[:port]），统计"按站点聚合"用。"""
    try:
        p = urllib.parse.urlsplit(normalize_url(url))
        return (p.hostname or "").lower() or "?"
    except ValueError:
        return "?"


# ─── 受限读取（防超大响应拖垮内存）───────────────────────────

def _read_limited(resp: requests.Response, limit: int, deadline=None) -> str:
    chunks, total = [], 0
    def chunks_from_response():
        raw = getattr(resp, 'raw', None)
        if raw is not None and hasattr(raw, 'read1'):
            while True:
                remaining = (deadline - time.monotonic()) if deadline else FETCH_TOTAL_SECONDS
                if remaining <= 0:
                    raise FetchError('抓取超过总期限 20 秒')
                connection = getattr(raw, '_connection', None)
                sock = getattr(connection, 'sock', None)
                if sock is not None:
                    sock.settimeout(min(FETCH_TIMEOUT[1], max(.01, remaining)))
                chunk = raw.read1(amt=min(64 * 1024, limit + 1 - total), decode_content=True)
                if not chunk:
                    return
                yield chunk
        else:  # Mock 响应与旧 requests 兼容；真实响应走 read1，避免慢速流一直攒满 chunk。
            yield from resp.iter_content(chunk_size=64 * 1024)
    for chunk in chunks_from_response():
        if not chunk:
            continue
        if deadline is not None and time.monotonic() > deadline:
            raise FetchError('抓取超过总期限 20 秒')
        chunks.append(chunk)
        total += len(chunk)
        if total > limit:
            raise FetchError(f'网页内容超过 {limit // 1024}KB，未保存截断内容')
    raw = b"".join(chunks)
    enc = resp.encoding
    if not enc or enc.lower() == "iso-8859-1":
        # apparent_encoding 会重新消费 response.content；必须只检测已限长的原始字节。
        from requests.compat import chardet
        enc = chardet.detect(raw[:64 * 1024]).get('encoding') or 'utf-8'
    try:
        return raw.decode(enc, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return raw.decode("utf-8", errors="replace")


def _get(url: str, what: str, limit: int) -> tuple[requests.Response, str]:
    deadline = time.monotonic() + FETCH_TOTAL_SECONDS
    try:
        for redirect in range(6):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise FetchError(f'{what}超过总期限 20 秒')
            resp = requests.get(url, timeout=(min(5, remaining), min(10, remaining)),
                headers={"User-Agent": UA}, stream=True, allow_redirects=False)
            location = resp.headers.get('Location') if hasattr(resp, 'headers') else None
            if 300 <= resp.status_code < 400 and location:
                resp.close()
                url = urllib.parse.urljoin(url, location)
                if not url.startswith(('http://', 'https://')):
                    raise FetchError('重定向目标仅支持 http(s)')
                continue
            break
        else:
            raise FetchError('重定向超过 5 次')
    except requests.RequestException as e:
        raise _net_error(what, e) from e
    if resp.status_code >= 400:
        resp.close()
        raise FetchError(f"{what}失败: HTTP {resp.status_code}")
    try:
        return resp, _read_limited(resp, limit, deadline)
    except FetchError:
        raise
    except Exception as error:
        from urllib3.exceptions import HTTPError
        if isinstance(error, (HTTPError, requests.RequestException, OSError)):
            raise FetchError(f'{what}失败: 网络读取超时或中断') from error
        raise
    finally:
        resp.close()


# ─── 元信息抓取 ─────────────────────────────────────────────

class _MetaParser(HTMLParser):
    """只取 <title> / <meta> / <link rel=icon> 的轻量解析器（前 64KB 足够）。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.metas: dict[str, str] = {}
        self.icon: Optional[str] = None

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").lower()
            content = a.get("content")
            if name and content and name not in self.metas:
                self.metas[name] = content.strip()
        elif tag == "link" and self.icon is None:
            rel = a.get("rel", "").lower()
            if "icon" in rel and a.get("href"):
                self.icon = a["href"]

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def fetch_meta(url: str) -> dict[str, Any]:
    """抓页面元信息 → {url(最终), title, description, site_name, favicon_url}。

    元信息缺省回退：title → host；favicon → 无（前端回退 origin/favicon.ico 或字母块）。
    """
    norm = normalize_url(url)
    if not norm.startswith(("http://", "https://")):
        raise FetchError("仅支持 http(s) 链接")
    resp, page = _get(url, "抓取元信息", META_LIMIT)
    parser = _MetaParser()
    try:
        parser.feed(page[:64 * 1024])
        parser.close()
    except Exception as e:  # noqa: BLE001 - 解析器对畸形 HTML 容错
        _log.warning("元信息解析异常: %s", e)

    base = resp.url or url
    title = (parser.title or "").strip() or (parser.metas.get("og:title") or "").strip()
    favicon = parser.icon
    if favicon:
        favicon = urllib.parse.urljoin(base, favicon)
    return {
        "url": base,
        "title": title[:512] if title else domain_of(base),
        "description": (parser.metas.get("description") or parser.metas.get("og:description") or "").strip() or None,
        "site_name": (parser.metas.get("og:site_name") or "").strip() or None,
        "favicon_url": favicon,
    }


# ─── 正文快照（HTML → Markdown 启发式抽取）───────────────────

# 噪音块整段移除（含内容）
_NOISE_RE = re.compile(
    r"<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|template)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# 主体候选：article > main > body（取最长命中）
_ARTICLE_RE = re.compile(r"<article\b[^>]*>(.*?)</article\s*>", re.IGNORECASE | re.DOTALL)
_MAIN_RE = re.compile(r"<main\b[^>]*>(.*?)</main\s*>", re.IGNORECASE | re.DOTALL)
_BODY_RE = re.compile(r"<body\b[^>]*>(.*?)</body\s*>", re.IGNORECASE | re.DOTALL)
# 行内元素
_A_RE = re.compile(r"<a\b[^>]*href=[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a\s*>", re.IGNORECASE | re.DOTALL)
_IMG_RE = re.compile(r"<img\b[^>]*src=[\"']([^\"']+)[\"'][^>]*>", re.IGNORECASE)
_BOLD_RE = re.compile(r"</?(strong|b)\b[^>]*>", re.IGNORECASE)
_ITALIC_RE = re.compile(r"</?(em|i)\b[^>]*>", re.IGNORECASE)
_CODE_RE = re.compile(r"</?(code|kbd)\b[^>]*>", re.IGNORECASE)
_DEL_RE = re.compile(r"</?(s|strike|del)\b[^>]*>", re.IGNORECASE)
_PRE_RE = re.compile(r"<pre\b[^>]*>(.*?)</pre\s*>", re.IGNORECASE | re.DOTALL)
_H_RE = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1\s*>", re.IGNORECASE | re.DOTALL)
_LI_RE = re.compile(r"<li\b[^>]*>(.*?)</li\s*>", re.IGNORECASE | re.DOTALL)


def _strip_tags(fragment: str) -> str:
    """去剩余标签 + 实体还原 + 压缩空白。"""
    text = re.sub(r"<(br|hr)\s*/?>", "\n", fragment, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return html_mod.unescape(text)


def _inline_md(fragment: str, base_url: str) -> str:
    """行内元素 → Markdown（a/img/strong/em/code/del 与图片绝对化）。"""
    def _a(m: re.Match) -> str:
        text = _strip_tags(m.group(2)).strip()
        if not text:
            return ""
        href = urllib.parse.urljoin(base_url, m.group(1))
        return f"[{text}]({href})"
    text = _A_RE.sub(_a, fragment)

    def _img(m: re.Match) -> str:
        src = urllib.parse.urljoin(base_url, m.group(1))
        return f"\n\n![图片]({src})\n\n"
    text = _IMG_RE.sub(_img, text)
    text = _BOLD_RE.sub("**", text)
    text = _ITALIC_RE.sub("*", text)
    text = _CODE_RE.sub("`", text)
    text = _DEL_RE.sub("~~", text)
    return text


def _html_to_md(fragment: str, base_url: str) -> str:
    """块级结构 → Markdown：标题/列表/引用/代码块先行，剩余按段落。"""
    out: list[str] = []

    def _h(m: re.Match) -> str:
        inner = _strip_tags(_inline_md(m.group(2), base_url)).strip()
        return f"\n\n{'#' * int(m.group(1))} {inner}\n\n" if inner else ""
    def _li(m: re.Match) -> str:
        inner = _strip_tags(_inline_md(m.group(1), base_url)).strip()
        return f"\n- {inner}" if inner else ""
    def _pre(m: re.Match) -> str:
        code = html_mod.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        return f"\n\n```\n{code}\n```\n\n" if code else ""

    text = _H_RE.sub(_h, fragment)
    text = _PRE_RE.sub(_pre, text)
    text = _LI_RE.sub(_li, text)
    text = _inline_md(text, base_url)
    # 段落切分：块级标签边界换成换行
    text = re.sub(r"</?(p|div|section|article|main|ul|ol|table|tr|td|th|blockquote|figure|figcaption|h[1-6])\b[^>]*>",
                  "\n", text, flags=re.IGNORECASE)
    text = _strip_tags(text)
    lines = [ln.strip() for ln in text.splitlines()]
    # 重组：去空行堆叠、列表行贴合
    buf: list[str] = []
    prev_blank = True
    for ln in lines:
        if not ln:
            if not prev_blank:
                buf.append("")
            prev_blank = True
        else:
            buf.append(ln)
            prev_blank = ln.startswith(("- ", "#", "```", "![")) or ln.startswith(">")
    md = "\n".join(buf).strip()
    # 引用块标记：此处不再深度处理 <blockquote>（内容已按段落展开）
    return md[:SNAPSHOT_MAX_CHARS]


def _legacy_extract_content(page_html: str, base_url: str = "") -> str:
    """主体抽取 + Markdown 化。article/main/body 取文本最长者，全无则整页。"""
    page = _COMMENT_RE.sub("", _NOISE_RE.sub("", page_html))
    candidates = [m.group(1) for m in _ARTICLE_RE.finditer(page)]
    candidates += [m.group(1) for m in _MAIN_RE.finditer(page)]
    body = _BODY_RE.search(page)
    if body:
        candidates.append(body.group(1))
    main = max(candidates, key=len, default=page) or page
    if len(_strip_tags(main)) * 4 < len(_strip_tags(page)):
        # 主体可读文本占比过低（抽取失败征兆）→ 回退整页
        main = page
    return _html_to_md(main, base_url)


def extract_content(page_html: str, base_url: str = "", *, adapter='markdownify') -> str:
    if adapter == 'legacy':
        return _legacy_extract_content(page_html, base_url)
    if adapter != 'markdownify':
        raise ValueError('未知正文提取适配器')
    from app.shared.html import article_html, html_to_markdown
    markdown = html_to_markdown(article_html(page_html, base_url), base_url)
    if len(markdown) > SNAPSHOT_MAX_CHARS:
        raise FetchError('快照正文超过 20 万字符，未保存截断内容')
    return markdown


def count_words(text: str) -> int:
    """字数：CJK 逐字 + 西文按词（与 diary 模块口径一致）。"""
    cjk = len(re.findall(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text))
    latin = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", text))
    return cjk + latin


def fetch_snapshot(url: str) -> dict[str, Any]:
    """抓正文 → {content_md, words}。空正文视为抓取失败（多数是 JS 渲染页）。"""
    norm = normalize_url(url)
    if not norm.startswith(("http://", "https://")):
        raise FetchError("仅支持 http(s) 链接")
    resp, page = _get(url, "抓取快照", SNAPSHOT_LIMIT)
    md = extract_content(page, resp.url or url)
    words = count_words(md)
    if words < 20:
        raise FetchError("未抽到可读正文（可能是 JS 渲染页或非文章页）")
    return {"content_md": md, "words": words, "final_url": resp.url}


# ─── 死链检测 ───────────────────────────────────────────────

def check_url(url: str) -> dict[str, Any]:
    """检测链接可达性 → {status: ok/dead/error, code}。

    HEAD 优先（省带宽）；405/403/400 等拒绝 HEAD 的站点回退 GET（stream 不拉正文）。
    <400 或受限码（401/403/405/429）= ok；其余 HTTP 响应 = dead；网络异常 = error。
    """
    norm = normalize_url(url)
    if not norm.startswith(("http://", "https://")):
        return {"status": "error", "code": None}
    headers = {"User-Agent": UA}
    deadline = time.monotonic() + FETCH_TOTAL_SECONDS
    def request_headers(method):
        current_url = norm
        for redirect in range(6):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise requests.Timeout('total deadline')
            kwargs = {'timeout': (min(5, remaining), min(CHECK_TIMEOUT, remaining)),
                      'allow_redirects': False, 'headers': headers}
            if method == 'get': kwargs['stream'] = True
            response = getattr(requests, method)(current_url, **kwargs)
            try:
                status = response.status_code
                location = getattr(response, 'headers', {}).get('Location')
                if 300 <= status < 400 and location:
                    current_url = urllib.parse.urljoin(current_url, location)
                    if not current_url.startswith(('http://', 'https://')):
                        raise requests.RequestException('unsupported redirect')
                    continue
                return status
            finally:
                response.close()
        raise requests.TooManyRedirects('redirect limit')
    try:
        code = request_headers('head')
        if code in (400, 403, 404, 405, 411) or 500 <= code < 600:
            code = request_headers('get')
    except requests.Timeout:
        _log.warning('死链检测超时: %s', norm)
        return {'status': 'error', 'code': None}
    except requests.RequestException as error:
        _log.warning('死链检测失败: %s: %s', type(error).__name__, error)
        return {'status': 'error', 'code': None}
    if code < 400 or code in _REACHABLE_CODES:
        return {"status": "ok", "code": code}
    return {"status": "dead", "code": code}
