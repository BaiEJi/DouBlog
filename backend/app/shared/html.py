"""HTML 文本适配器：网络由业务层管理，仅转换已限长 HTML。

markdownify 1.2.3 (MIT) + BeautifulSoup；旧提取器可由调用方显式选择。
保留表格、嵌套列表和代码，统一相对 URL，禁止脚本/事件处理器进入 Markdown。
"""
import re
from urllib.parse import urljoin, urlsplit


def _soup(fragment, base_url=''):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(fragment or '', 'html.parser')
    for element in soup(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form']):
        element.decompose()
    for element in soup.find_all(True):
        for attribute in list(element.attrs):
            if attribute.lower().startswith('on'):
                del element[attribute]
        for attribute in ('href', 'src'):
            value = element.get(attribute)
            if not isinstance(value, str):
                continue
            try:
                absolute = urljoin(base_url, value)
                scheme = urlsplit(absolute).scheme.lower()
            except ValueError:
                del element[attribute]
                continue
            if scheme and scheme not in ('http', 'https', 'mailto'):
                del element[attribute]
            else:
                element[attribute] = absolute
    return soup


def html_to_markdown(fragment, base_url=''):
    from markdownify import MarkdownConverter

    class Converter(MarkdownConverter):
        def convert_br(self, element, text, parent_tags):
            # 保持既有编辑器的纯换行语义，避免同一正文迁移后出现空格差异。
            return '\n'

        def convert_pre(self, element, text, parent_tags):
            code = element.find('code') or element
            language = ''
            for value in code.get('class', []):
                if value.startswith(('language-', 'lang-')):
                    language = value.split('-', 1)[1]
                    break
            language = re.sub(r'[^A-Za-z0-9_+.-]', '', language)[:32]
            source = code.get_text('', strip=False).replace('\xa0', ' ')
            longest = max((len(value) for value in re.findall(r'`+', source)), default=0)
            fence = '`' * max(3, longest + 1)
            return f'\n\n{fence}{language}\n{source.rstrip()}\n{fence}\n\n'

    soup = _soup(fragment, base_url)
    markdown = Converter(heading_style='ATX', bullets='-', sub_symbol='~', sup_symbol='^',
        escape_underscores=False, escape_asterisks=False, wrap=False).convert_soup(soup)
    return markdown.replace('\xa0', ' ').strip()


def article_html(page_html, base_url=''):
    """优先正文语义容器；导航更长时也不会压过 article/main。"""
    soup = _soup(page_html, base_url)
    for element in soup(['nav', 'header', 'footer', 'aside']):
        element.decompose()
    for element in list(soup.find_all(True)):
        if element.parent is None:
            continue
        markers = ' '.join([str(element.get('id') or ''), *element.get('class', [])]).lower()
        if re.search(r'(?:^|[\s_-])(sidebar|breadcrumb|advertisement|cookie-banner|related-posts)(?:$|[\s_-])', markers):
            element.decompose()
    def score(element):
        text_length = len(element.get_text(' ', strip=True))
        link_length = sum(len(link.get_text(' ', strip=True)) for link in element.find_all('a'))
        paragraphs = len(element.find_all(['p', 'pre', 'table', 'li']))
        return text_length - link_length * 2 + min(100, paragraphs) * 30
    candidates = soup.find_all('article') or soup.find_all('main')
    if not candidates:
        candidates = [soup.body or soup]
    return str(max(candidates, key=score))
