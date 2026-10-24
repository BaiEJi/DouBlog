"""
知识库（Workspace）列级幂等迁移

由骨架 init_db 在建表、存量表改名之后调用（ensure_migrations(engine)）：
新库 create_all 已建全列，全部步骤自动跳过；存量库按需补列/回填。
"""

from sqlalchemy import inspect, text


def ensure_migrations(engine):
    """
    知识库（Workspace）幂等迁移：

    1. 存量库的 blog_posts 表缺 workspace_id 列 → ALTER TABLE 补列（create_all 不会改已有表）
    2. 无任何知识库 → 创建"默认知识库"
    3. 存量文章 workspace_id 为空 → 全部归入默认知识库
    4. 把虚拟根(id=0)的顶级文章顺序拷贝给默认知识库（首次升级时的顺序保留）
    """
    from app.blog.models import Workspace

    # 1. 补列（sqlite/pg 同语法）
    inspector = inspect(engine)
    post_columns = {c['name'] for c in inspector.get_columns('blog_posts')}
    if 'workspace_id' not in post_columns:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE blog_posts ADD COLUMN workspace_id INTEGER'))
        index_name = 'ix_blog_posts_workspace_id'
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('blog_posts')}
        if index_name not in existing_indexes:
            with engine.begin() as conn:
                conn.execute(text(f'CREATE INDEX {index_name} ON blog_posts (workspace_id)'))

    # 最近浏览时间列（幂等）
    if 'last_viewed_at' not in post_columns:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE blog_posts ADD COLUMN last_viewed_at TIMESTAMP'))
    for name, ddl in [('revision', 'INTEGER NOT NULL DEFAULT 1'), ('links_hash', 'VARCHAR(64)')]:
        if name not in post_columns:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE blog_posts ADD COLUMN {name} {ddl}'))
    ws_columns = {column['name'] for column in inspector.get_columns('blog_workspaces')}
    if 'revision' not in ws_columns:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE blog_workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 1'))

    with engine.begin() as conn:
        # 2. 默认知识库
        ws_count = conn.execute(text('SELECT COUNT(*) FROM blog_workspaces')).scalar() or 0
        if ws_count == 0:
            root_order = conn.execute(
                text('SELECT children_order FROM blog_posts WHERE id = 0')
            ).scalar()
            conn.execute(Workspace.__table__.insert().values(
                name='默认知识库',
                children_order=root_order,
            ))

        # 3. 回填归属
        default_ws_id = conn.execute(
            text('SELECT MIN(id) FROM blog_workspaces')
        ).scalar()
        conn.execute(text(
            'UPDATE blog_posts SET workspace_id = :ws_id WHERE workspace_id IS NULL'
        ).bindparams(ws_id=default_ws_id))
        duplicates = conn.execute(text('SELECT workspace_id,name,COUNT(*) FROM blog_posts WHERE id != 0 '
            'GROUP BY workspace_id,name HAVING COUNT(*) > 1')).all()
        if duplicates:
            from app.shared.modules import mod_logger
            mod_logger('blog').warning('库内英文名唯一索引未启用；重复组=%s', [tuple(row) for row in duplicates])
        else:
            conn.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_workspace_name '
                              'ON blog_posts (workspace_id,name) WHERE id != 0'))
    from sqlalchemy.orm import Session
    from .links import rebuild_link_index
    from app.blog.models import PostLink
    PostLink.__table__.create(engine, checkfirst=True)
    with Session(engine) as session:
        rebuild_link_index(session)
        session.commit()
