"""一键抓题适配器：LeetCode GraphQL 代理 + 洛谷 content-only JSON（不落库，返回标准化草稿）。

LeetCode（2026-10 实测）：
- 优先国际版 leetcode.com/graphql/（CN 站有 alicfw WAF cookie challenge，简单 POST 会被拦）
- translatedTitle/translatedContent 为 null 时回退英文 title/content
- 难度 Easy/Medium/Hard → 1/2/3，未知 → 2（中性）；HTML→Markdown 用简单正则（规范决策，不引 html2text）

洛谷（2026-10 API 变更：_contentOnly 已废弃，302 + HTML）：
- 新方案：requests.Session + 请求头 ``x-lentille-request: content-only``
  （Session 自动处理 C3VK cookie challenge）；UA 'Mozilla/5.0 (compatible; DouBlog/1.0)'
- 响应题目在 ``payload[data].currentData.problem``（两种嵌套都兼容）
- 字段：content.background/description/formatI/formatO/hint（旧 inputFormat/outputFormat 回退兼容）
- 标题 name；难度 9 级（0-8）：0（暂无评定）→2 中性、1-3→1、4-5→2、6-8→3
- tags 为数字 ID 数组，名称映射从 /_lfe/tags 拉取（进程内缓存 24h，失败不阻断抓题）
- content 各段本就是 Markdown，但防御性剥离任何混入的 HTML 标签（P1-B）

通用：requests 库，10s 超时；草稿进程内缓存 1h（256 条按插入序驱逐，P2-C）；
洛谷标签映射独立缓存池（24h / 失败负缓存 60s，与草稿分池互不驱逐，R9-2）；
网络异常收敛为 FetchError 分类文案，原文记 warning 日志（P2-E）。
"""
from __future__ import annotations

import html as html_mod
import re
import threading
import time
from typing import Any

import requests

from app.shared.modules import mod_logger

LEETCODE_GRAPHQL = "https://leetcode.com/graphql/"
LUOGU_PROBLEM_URL = "https://www.luogu.com.cn/problem/{pid}"
LUOGU_TAGS_URL = "https://www.luogu.com.cn/_lfe/tags"
LUOGU_UA = "Mozilla/5.0 (compatible; DouBlog/1.0)"
FETCH_TIMEOUT = 10
CACHE_TTL = 3600          # 草稿缓存 1h
TAGS_CACHE_TTL = 86400    # 洛谷标签表缓存 24h
TAGS_NEGATIVE_TTL = 60    # 标签表拉取失败的负缓存 60s（P2-F）

# 难度映射（docs/practice-spec.md）；未知难度 → 2（中等，中性，第 6 轮-3）
LEETCODE_DIFFICULTY = {"Easy": 1, "Medium": 2, "Hard": 3}
UNKNOWN_DIFFICULTY = 2


class FetchError(Exception):
    """抓取失败（网络/题目不存在/会员题等），message 直接展示给用户。"""


_log = mod_logger("todo")


def _net_error(site: str, e: Exception) -> FetchError:
    """P2-E：网络异常收敛为分类文案（不把 requests 内部细节透给用户）。

    Timeout（含 ConnectTimeout）→ 网络超时；ConnectionError → 无法连接；
    其余 RequestException → 请求异常。原始异常只进 warning 日志。
    """
    if isinstance(e, requests.Timeout):
        reason = "网络超时"
    elif isinstance(e, requests.ConnectionError):
        reason = "无法连接"
    else:
        reason = "请求异常"
    _log.warning("%s 抓题失败: %s: %s", site, type(e).__name__, e)
    return FetchError(f"{site} 请求失败: {reason}")


# ─── 进程内缓存 ──────────────────────────────────────────

# R9-2：草稿缓存与洛谷标签映射缓存分池——此前共用一个 dict，标签映射（24h TTL、
# 全站只有一条）会被批量抓题的草稿（1h TTL、256 上限按插入序驱逐）挤出，
# 每题都重打 /_lfe/tags；分池后各自独立 256 上限驱逐，互不挤占
_CACHE: dict[str, tuple[float, Any]] = {}        # 抓题草稿（1h TTL）
_TAGS_CACHE: dict[str, tuple[float, Any]] = {}   # 洛谷标签 ID→名称映射（24h / 负缓存 60s）
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 256


def _pool_get(cache: dict, key: str) -> Any | None:
    """命中返回浅拷贝（R16-3）：调用方改写返回 dict 不再污染缓存本体
    （草稿的 tag_names 列表等嵌套结构仍共享，只读消费不变）。"""
    with _CACHE_LOCK:
        hit = cache.get(key)
        if hit and hit[0] > time.time():
            return dict(hit[1]) if isinstance(hit[1], dict) else hit[1]
        cache.pop(key, None)
    return None


def _pool_put(cache: dict, key: str, value: Any, ttl: float) -> None:
    with _CACHE_LOCK:
        # P2-C：满 256 条按插入序驱逐最旧再 put——此前只清过期项，
        # 全部未过期时（典型：一次导入大量抓题）缓存无界增长
        while len(cache) >= _CACHE_MAX:
            cache.pop(next(iter(cache)))
        cache[key] = (time.time() + ttl, value)


def _cache_get(key: str) -> Any | None:
    return _pool_get(_CACHE, key)


def _cache_put(key: str, value: Any, ttl: float = CACHE_TTL) -> None:
    _pool_put(_CACHE, key, value, ttl)


def _tags_cache_get(key: str) -> Any | None:
    return _pool_get(_TAGS_CACHE, key)


def _tags_cache_put(key: str, value: Any, ttl: float) -> None:
    _pool_put(_TAGS_CACHE, key, value, ttl)


def clear_cache() -> None:
    """清空抓题缓存（测试用，含标签映射池）。"""
    with _CACHE_LOCK:
        _CACHE.clear()
        _TAGS_CACHE.clear()


# ─── HTML → Markdown（简单正则，LeetCode 描述结构够用）──

def _html_to_md(html: str) -> str:
    """HTML → Markdown（简单正则，LeetCode 描述结构够用）。

    顺序关键：先处理结构性标签、再剥离剩余标签、**最后**才解码 HTML 实体。
    若先解码 ``&lt;``/``&gt;`` 再跑标签正则，"2 &lt;= i &lt;= 10" 会被当成
    标签整体剥掉，约束文本直接丢失（P1-A）。html.unescape 兜底覆盖
    &le;/&ge;/&nbsp;/数字实体等全套。
    """
    if not html:
        return ""
    s = html
    # 1. 先处理结构性标签（不解码实体）
    s = re.sub(r'<pre[^>]*>\s*<code[^>]*>(.*?)</code>\s*</pre>',
               lambda m: '\n```\n' + m.group(1) + '\n```\n', s, flags=re.S)
    s = re.sub(r'<sup[^>]*>(.*?)</sup>', lambda m: '^' + m.group(1).strip() + '^', s, flags=re.S)
    s = re.sub(r'<sub[^>]*>(.*?)</sub>', lambda m: '~' + m.group(1).strip() + '~', s, flags=re.S)
    s = re.sub(r'<strong[^>]*>(.*?)</strong>', lambda m: '**' + m.group(1) + '**', s, flags=re.S)
    s = re.sub(r'<em[^>]*>(.*?)</em>', lambda m: '*' + m.group(1) + '*', s, flags=re.S)
    s = re.sub(r'<code[^>]*>(.*?)</code>', lambda m: '`' + m.group(1) + '`', s, flags=re.S)
    s = re.sub(r'<a[^>]+href="([^"]*)"[^>]*>(.*?)</a>', r'[\2](\1)', s, flags=re.S)
    s = re.sub(r'<li[^>]*>(.*?)</li>', lambda m: '- ' + m.group(1).strip(), s, flags=re.S)
    s = re.sub(r'<[ou]l[^>]*>', '', s)
    s = re.sub(r'</[ou]l>', '', s)
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'<p[^>]*>(.*?)</p>', lambda m: m.group(1).strip() + '\n\n', s, flags=re.S)
    # 2. 剥离剩余标签
    s = re.sub(r'<[^>]+>', '', s)
    # 3. 最后才解码实体（html.unescape 处理 &le; &ge; &nbsp; 等）
    s = html_mod.unescape(s)
    s = s.replace('\xa0', ' ')  # &nbsp; 解码为 U+00A0，markdown 里当普通空格
    # 4. 清理
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def _strip_html(s: Any) -> str:
    """P1-B：洛谷内容防御性剥离混入的 HTML 标签。

    洛谷 content 各段本就是 Markdown（正常内容不含标签），不走 LeetCode 的
    _html_to_md 全套转换——简单剥标签即可，避免误伤 Markdown 原文结构。
    """
    return re.sub(r"<[^>]+>", "", str(s))


# ─── LeetCode（国际版，无 WAF）──────────────────────────

_LEETCODE_QUERY = """query questionDetail($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        translatedTitle
        difficulty
        content
        translatedContent
        isPaidOnly
        topicTags { name slug translatedName }
    }
}"""

_LEETCODE_SLUG_RE = re.compile(r"leetcode\.(?:cn|com)/problems/([a-z0-9-]+)", re.I)


def _leetcode_slug_from_url(url: str) -> str | None:
    m = _LEETCODE_SLUG_RE.search(url or "")
    return m.group(1).strip("/") if m else None


def fetch_leetcode(slug: str) -> dict:
    """LeetCode 题目草稿。slug 或 leetcode.com|cn/problems/<slug>/ URL。"""
    slug = _leetcode_slug_from_url(slug) or (slug or "").strip().strip("/").split("?")[0]
    if not slug:
        raise FetchError("缺少题目 slug")
    if slug.isdigit():
        # LeetCode slug 不含纯数字（two-sum 等），纯题号查询必然落空
        raise FetchError(
            "LeetCode 暂不支持纯题号，请粘贴完整链接（如 https://leetcode.cn/problems/two-sum/）")
    cache_key = f"leetcode:{slug}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        resp = requests.post(
            LEETCODE_GRAPHQL,
            json={"query": _LEETCODE_QUERY, "variables": {"titleSlug": slug}},
            timeout=FETCH_TIMEOUT,
        )
        resp.raise_for_status()
        payload = resp.json()
    except requests.RequestException as e:
        raise _net_error("LeetCode", e) from e
    except ValueError as e:
        raise FetchError("LeetCode 响应不是合法 JSON") from e

    data = (payload.get("data") or {}).get("question")
    if not data:
        raise FetchError("LeetCode 国际版未收录该题（可能是中文站独有），"
                         "请粘贴 leetcode.cn 链接或直接输入 slug")
    if data.get("isPaidOnly"):
        raise FetchError("会员题")

    difficulty = LEETCODE_DIFFICULTY.get(data.get("difficulty") or "",
                                         UNKNOWN_DIFFICULTY)  # 未知 → 2（中性）
    # 国际版无中文翻译：translatedXxx 为 null 时回退英文
    title = data.get("translatedTitle") or data.get("title") or slug
    content_html = data.get("translatedContent") or data.get("content") or ""
    tags = [(t.get("translatedName") or t.get("name"))
            for t in (data.get("topicTags") or []) if t.get("name")]

    draft = {
        "source": "leetcode",
        "source_no": data.get("questionFrontendId") or "",
        "title": title,
        "difficulty": difficulty,
        "url": f"https://leetcode.com/problems/{slug}/description/",
        "description_md": _html_to_md(content_html),
        "tag_names": [t for t in tags if t],  # 与 ProblemCreate.tag_names 对齐（直接落库）
        "pitfall_md": "",
    }
    _cache_put(cache_key, draft)
    return draft


# ─── 洛谷（content-only JSON，Session 处理 cookie challenge）──

_LUOGU_PID_RE = re.compile(r"luogu\.com\.cn/problem/([A-Za-z0-9_]+)", re.I)

_LUOGU_SESSION: requests.Session | None = None
_SESSION_LOCK = threading.Lock()


def _luogu_session() -> requests.Session:
    """共享 Session（自动携带 challenge cookie）；UA 见模块头说明。"""
    global _LUOGU_SESSION
    with _SESSION_LOCK:
        if _LUOGU_SESSION is None:
            s = requests.Session()
            s.headers["User-Agent"] = LUOGU_UA
            s.headers["Referer"] = "https://www.luogu.com.cn/"
            _LUOGU_SESSION = s
        return _LUOGU_SESSION


def _luogu_pid_from_url(url: str) -> str | None:
    m = _LUOGU_PID_RE.search(url or "")
    return m.group(1) if m else None


def _luogu_current_data(payload: Any) -> dict:
    """兼容新旧嵌套：payload.currentData / payload.data.currentData。"""
    if not isinstance(payload, dict):
        return {}
    cur = payload.get("currentData")
    if isinstance(cur, dict):
        return cur
    data = payload.get("data")
    if isinstance(data, dict):
        cur = data.get("currentData")
        if isinstance(cur, dict):
            return cur
        if "problem" in data:
            return data
    return {}


def _luogu_difficulty(score: Any) -> int:
    """9 级制（0-8）：0=暂无评定→2（中等，中性，第 6 轮-3）、1-3→1、4-5→2、6-8→3。

    非数值难度（缺字段/畸形数据）同取中性默认 2，不偏置为「简单」。
    """
    try:
        score = int(score)
    except (TypeError, ValueError):
        return UNKNOWN_DIFFICULTY
    if score <= 0:
        return UNKNOWN_DIFFICULTY  # 0 = 暂无评定 → 中性默认
    if score <= 3:
        return 1
    if score <= 5:
        return 2
    return 3


def _luogu_tag_names(session: requests.Session, tag_ids: list) -> list[str]:
    """数字标签 ID → 名称（/_lfe/tags 映射，24h 缓存；失败负缓存 60s 后降级为空）。

    R9-2：映射存独立 _TAGS_CACHE 池——与草稿缓存（256 上限按插入序驱逐）分池，
    批量抓题不会把全站唯一的标签映射挤出缓存。
    """
    ids = [str(t) for t in tag_ids if str(t)]
    if not ids:
        return []
    cached = _tags_cache_get("luogu:tags-map")
    if cached is None:
        try:
            resp = session.get(LUOGU_TAGS_URL, timeout=FETCH_TIMEOUT)
            resp.raise_for_status()
            rows = resp.json()
            mapping: dict[str, str] = {}
            if isinstance(rows, list):
                for entry in rows:
                    # 形如 [id, type, "名称"]；若为 [id, "名称", type] 取第一个非数字串
                    if not isinstance(entry, (list, tuple)) or len(entry) < 3:
                        continue
                    tid = str(entry[0])
                    name = entry[2] if isinstance(entry[2], str) else (
                        entry[1] if isinstance(entry[1], str) else None)
                    if tid and name:
                        mapping[tid] = name
            cached = mapping
            _tags_cache_put("luogu:tags-map", mapping, ttl=TAGS_CACHE_TTL)
        except (requests.RequestException, ValueError):
            # P2-F：失败写 60s 负缓存（空 dict）——同批连续抓题不再逐题重打
            # /_lfe/tags（此前失败结果不落缓存，每题都重新超时一轮）
            cached = {}
            _tags_cache_put("luogu:tags-map", {}, ttl=TAGS_NEGATIVE_TTL)
    return [cached[i] for i in ids if i in cached]


def fetch_luogu(pid: str) -> dict:
    """洛谷题目草稿。pid（如 P1001/U123）或 luogu.com.cn/problem/<pid> URL。"""
    pid = _luogu_pid_from_url(pid) or (pid or "").strip().strip("/").split("?")[0]
    if not pid or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", pid):
        raise FetchError("缺少有效的洛谷题目编号")
    cache_key = f"luogu:{pid.upper()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    session = _luogu_session()
    try:
        resp = session.get(
            LUOGU_PROBLEM_URL.format(pid=pid),
            headers={"x-lentille-request": "content-only"},
            timeout=FETCH_TIMEOUT,
        )
        if getattr(resp, "status_code", None) == 404:
            raise FetchError("题目不存在，请检查题号")
        resp.raise_for_status()
        payload = resp.json()
    except requests.RequestException as e:
        raise _net_error("洛谷", e) from e
    except ValueError as e:
        raise FetchError("洛谷响应不是合法 JSON") from e

    data = _luogu_current_data(payload).get("problem")
    if not data:
        raise FetchError("题目不存在")

    # 新版字段在 content 下（formatI/formatO）；旧版直接挂在 problem 上（inputFormat/outputFormat）
    content = data.get("content") or {}
    # P1-B：各段防御性剥离混入的 HTML 标签（正常内容是纯 Markdown，不受影响）
    background = _strip_html(content.get("background") or data.get("background") or "")
    description = _strip_html(content.get("description") or data.get("description") or "")
    input_format = _strip_html(content.get("formatI") or data.get("inputFormat") or "")
    output_format = _strip_html(content.get("formatO") or data.get("outputFormat") or "")
    hint = _strip_html(content.get("hint") or data.get("hint") or "")
    samples = content.get("samples") or data.get("samples") or []
    if not isinstance(samples, (list, tuple)):
        samples = []
    title = data.get("name") or data.get("title") or pid

    parts: list[str] = []
    if background:
        parts += ["## 题目背景", "", background.strip(), ""]
    if description:
        parts += ["## 题目描述", "", description.strip(), ""]
    if input_format:
        parts += ["## 输入格式", "", input_format.strip(), ""]
    if output_format:
        parts += ["## 输出格式", "", output_format.strip(), ""]
    for i, sample in enumerate(samples, start=1):
        if not isinstance(sample, (list, tuple)) or len(sample) < 2:
            continue  # 防御：畸形样例（None/字符串/缺输出）跳过，不炸整个抓题
        parts += [f"## 样例 {i}", "",
                  f"**输入 #{i}**", "", "```input", str(sample[0]).rstrip(), "```", "",
                  f"**输出 #{i}**", "", "```output", str(sample[1]).rstrip(), "```", ""]
    if hint:
        parts += ["## 说明/提示", "", hint.strip(), ""]

    tags = _luogu_tag_names(session, data.get("tags") or [])

    draft = {
        "source": "luogu",
        "source_no": str(data.get("pid") or pid),
        "title": str(title),
        "difficulty": _luogu_difficulty(data.get("difficulty")),
        "url": f"https://www.luogu.com.cn/problem/{pid}",
        "description_md": "\n".join(parts).strip(),
        "tag_names": tags,  # 与 ProblemCreate.tag_names 对齐（直接落库）
        "pitfall_md": "",
    }
    _cache_put(cache_key, draft)
    return draft


# ─── 统一入口 ────────────────────────────────────────────

def fetch_problem(source: str, url: str = "", slug: str = "", source_no: str = "") -> dict:
    """按 source 分发；auto 由 URL/编号形态识别。返回标准化草稿（不落库）。"""
    ident = (url or slug or source_no or "").strip()
    if not ident:
        raise FetchError("缺少题目链接或编号")

    if source == "leetcode":
        return fetch_leetcode(ident)
    if source == "luogu":
        return fetch_luogu(ident)

    # auto：URL 域名 → 站点；否则编号形态（P/SP/B/U/T/CF+数字 → 洛谷，slug → LeetCode）
    low = ident.lower()
    if "leetcode." in low:
        return fetch_leetcode(ident)
    if "luogu." in low:
        return fetch_luogu(ident)
    if re.fullmatch(r"(?:SP|CF|P|B|U|T)[0-9]+", ident.upper()):
        return fetch_luogu(ident)
    return fetch_leetcode(ident)
