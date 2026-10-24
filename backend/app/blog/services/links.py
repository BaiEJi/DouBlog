"""双链正文写时投影，兼容种子/导入等 ORM 写入；浏览查询不扫描正文。"""
import hashlib
import re

from sqlalchemy import delete, event, inspect, update
from app.blog.models import Post, PostLink

WIKI_LINK_RE = re.compile(r'\[\[([^\[\]]+)\]\]')


def _index(connection, post):
    if post.id == 0:
        return
    digest = hashlib.sha256((post.content or '').encode()).hexdigest()
    if post.links_hash == digest and not inspect(post).attrs.workspace_id.history.has_changes():
        return
    targets = {match.split('|', 1)[0].strip() for match in WIKI_LINK_RE.findall(post.content or '')}
    connection.execute(delete(PostLink).where(PostLink.source_id == post.id))
    values = [{'source_id': post.id, 'workspace_id': post.workspace_id, 'target_text': target}
              for target in targets if target and len(target) <= 500]
    if values:
        connection.execute(PostLink.__table__.insert(), values)
    connection.execute(update(Post.__table__).where(Post.id == post.id).values(links_hash=digest))


@event.listens_for(Post, 'after_insert')
@event.listens_for(Post, 'after_update')
def index_post(mapper, connection, target):
    state = inspect(target)
    if target.links_hash is None or state.attrs.content.history.has_changes() or state.attrs.workspace_id.history.has_changes():
        _index(connection, target)


@event.listens_for(Post, 'after_delete')
def remove_post_index(mapper, connection, target):
    connection.execute(delete(PostLink).where(PostLink.source_id == target.id))


def rebuild_link_index(session):
    """存量库首迁移/维护工具调用；哈希存在的正常行不再读取正文。"""
    from sqlalchemy import select
    for post in session.scalars(select(Post).where(Post.id != 0, Post.links_hash.is_(None)).execution_options(yield_per=100)):
        _index(session.connection(), post)
