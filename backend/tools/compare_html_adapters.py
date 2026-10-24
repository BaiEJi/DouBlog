"""Fixed offline extraction corpus; optional timing is separate from site A/B.

Run after full-suite CPU contention has ended. No network and no user database.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.blog.bookmarks.fetcher import extract_content

CORPUS = [
    ('cjk-long-navigation', '<article><h1>中文标题</h1><p>中文正文标记，保存知识。</p></article>',
     ['# 中文标题', '中文正文标记']),
    ('english-nested-list', '<main><h2>Article heading</h2><p>Article paragraph token.</p><ul><li>Outer<ul><li>Inner</li></ul></li></ul></main>',
     ['## Article heading', 'Article paragraph token.', 'Outer', 'Inner']),
    ('structured-table', '<article><table><tr><th>Key</th><th>Value</th></tr><tr><td>alpha</td><td>beta</td></tr></table></article>',
     ['| Key | Value |', '| alpha | beta |']),
    ('fenced-code', '<article><pre><code class="language-python">print("``` literal")\n  keep_indent()</code></pre></article>',
     ['````python', '  keep_indent()']),
    ('math-and-relative-link', '<article><p>x<sup>2</sup> + H<sub>2</sub>O; 2 &lt;= i &lt;= 10</p><a href="/reference">reference</a></article>',
     ['^2^', '~2~', '2 <= i <= 10', 'https://example.org/reference']),
]


def compare(repeat):
    results = []
    for name, body, markers in CORPUS:
        page = '<html><body><nav>' + '<a href="/noise">NAVIGATION-NOISE</a>' * 200 + '</nav>' + body + '<footer>FOOTER-NOISE</footer></body></html>'
        item = {'name': name, 'bytes': len(page.encode()), 'markers': markers, 'adapters': {}}
        for adapter in ('legacy', 'markdownify'):
            durations = []
            # Warm import/parser state before reporting conversion CPU time.
            markdown = extract_content(page, 'https://example.org/article', adapter=adapter)
            for _ in range(repeat):
                start = time.perf_counter()
                markdown = extract_content(page, 'https://example.org/article', adapter=adapter)
                durations.append((time.perf_counter() - start) * 1000)
            item['adapters'][adapter] = {'preserved': sum(marker in markdown for marker in markers),
                'expected': len(markers), 'navigation_removed': 'NAVIGATION-NOISE' not in markdown,
                'footer_removed': 'FOOTER-NOISE' not in markdown, 'characters': len(markdown),
                'median_ms': statistics.median(durations), 'max_ms': max(durations), 'markdown': markdown}
        results.append(item)
    return {'corpus': 'Fixed synthetic CJK/English structural HTML; no external pages or network',
            'repeat': repeat, 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeat', type=int, default=30)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    inputs = [Path(__file__), Path(__file__).resolve().parents[1] / 'app/shared/html.py',
              Path(__file__).resolve().parents[1] / 'app/blog/bookmarks/fetcher.py']
    start = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    result = compare(max(1, args.repeat))
    end = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    if start != end:
        raise RuntimeError('HTML comparison sources changed during measurement')
    result.update(source_hashes=start, source_unchanged=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
