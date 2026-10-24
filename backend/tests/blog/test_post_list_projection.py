"""文章列表排除未用列，完整DTO/祖先路径/查询数保留。"""
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session


@pytest.mark.parametrize('level,sql_count', [(0, 3), (1, 4), (2, 5)])
def test_post_list_excludes_unused_columns_without_lazy_queries(client, auth_headers, app, level, sql_count):
    from app.blog.models import Post, Workspace

    stamp = datetime(2026, 10, 21, 4, 5, 6, 123456, tzinfo=timezone.utc)
    with Session(app.state.engine) as session:
        workspace = Workspace(name='列表投影验证')
        session.add(workspace)
        session.flush()
        parent_id, posts, slugs = 0, [], []
        for depth, name in enumerate(('projection-root', 'projection-child', 'projection-grand')):
            slug = '/' + '/'.join(('projection-root', 'projection-child', 'projection-grand')[:depth + 1])
            post = Post(workspace_id=workspace.id, parent_id=parent_id, level=depth,
                name=name, title=f'投影标题 {depth}', slug=slug, content='大正文' * 10000,
                summary=f'摘要 {depth}', author='投影作者', status='published',
                revision=depth + 7, links_hash=str(depth) * 64, view_count=depth + 10,
                tags=json.dumps(['中文', f'层{depth}'], ensure_ascii=False), meta_data='{"keep":true}',
                last_viewed_at=stamp if depth else None, created_at=stamp, updated_at=stamp)
            session.add(post)
            session.flush()
            if posts:
                # 有效且大体积的顺序JSON，实际兄弟集合保持一致。
                posts[-1].children_order = ' ' * 25000 + json.dumps([post.id]) + ' ' * 25000
            posts.append(post)
            slugs.append(slug)
            parent_id = post.id
        posts[-1].children_order = ' ' * 25000 + '[]' + ' ' * 25000
        session.commit()
        # 监听前独立完整ORM参照；请求的独立Session不能借用这些已加载字段。
        selected = session.get(Post, posts[level].id)
        expected = selected.to_dict(include_content=False)
        expected.update(slug=slugs[level], children_count=1 if level < 2 else 0)
        workspace_id, selected_parent = workspace.id, selected.parent_id

    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        if 'blog_posts' in statement.lower():
            statements.append(statement.lower())
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/posts', params={'workspace_id': workspace_id,
            'parent_id': selected_parent, 'page': 1, 'page_size': 100}, headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)

    assert response.status_code == 200, response.text
    assert response.json()['data'] == {'items': [expected], 'total': 1,
        'page': 1, 'page_size': 100, 'total_pages': 1}
    assert len(statements) == sql_count, statements
    projections = [sql.split('from', 1)[0] for sql in statements]
    assert all(column not in projection for column in (
        'blog_posts.content', 'blog_posts.children_order', 'blog_posts.links_hash') for projection in projections), projections
