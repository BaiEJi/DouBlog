"""全站优化的隔离数据 fixture。只接受显式 engine，严禁从生产配置自行建连接。

baseline/current 使用同一个脚本；全部插入字段在优化前即存在。seed 不包含压测计时。
"""
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from zipfile import ZipFile

from sqlalchemy import insert
from sqlalchemy.orm import Session


def seed_knowledge(engine, *, large=False):
    from app.blog.models import Post, Workspace
    from app.blog.diary.models import Diary, DiaryJournal
    from app.blog.assets.models import AssetCategory, AssetFile, AssetItem, AssetVersion
    from app.todo.models import Task
    from app.practice.models import PracticeProblem, PracticeSolution, PracticeSolutionCode
    from app.subs.models import SubsCategory, SubsMember, SubsSubscription
    now = datetime(2026, 10, 21, 4, 0, tzinfo=timezone.utc)
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, 'w') as archive_zip:
        archive_zip.writestr('fixture/SKILL.md', '---\nname: optimization-fixture\ndescription: isolated quality fixture\n---\n# Fixture\n')
        archive_zip.writestr('fixture/docs/example.md', '测试文件\n' * 100)
    archive = archive_buffer.getvalue()
    count = 10000 if large else 2105
    with Session(engine) as session:
        workspace = Workspace(name='优化验收知识库', description='isolated fixture')
        session.add(workspace); session.flush()
        posts = [{'workspace_id': workspace.id, 'parent_id': 0, 'level': 0,
                  'title': f'验收文档 {i:05}', 'name': f'qa-post-{i:05}',
                  'slug': f'/qa-post-{i:05}', 'content': ('说明文字\n' * 1000) + ('[[qa-post-00000]]' if i % 10 == 1 else ''),
                  'summary': f'摘要 {i}', 'status': 'published'} for i in range(count)]
        session.execute(insert(Post), posts)
        session.flush()
        post_id = session.query(Post.id).filter(Post.workspace_id == workspace.id).order_by(Post.id).first()[0]
        # 现版本的投影迁移在 bulk fixture 后显式重建；旧版本没有此能力。
        try:
            from app.blog.services.links import rebuild_link_index
        except ImportError:
            pass
        else:
            rebuild_link_index(session)
        journal = DiaryJournal(name='优化验收日记本', emoji='📒', sort=99)
        category = AssetCategory(name='优化验收资产', kind='all')
        subs_category = SubsCategory(name='优化验收订阅', color='#8b5cf6', icon='📺')
        session.add_all([journal, category, subs_category]); session.flush()
        session.execute(insert(Diary), [{'entry_date': (date(2026, 10, 21) - timedelta(days=i // 3)).isoformat(),
            'journal_id': journal.id, 'kind': 'note', 'content': f'随记 {i}\n' + '长文正文\n' * 1000,
            'word_count': 4000} for i in range(10000 if large else 505)])
        asset_ids = []
        for i in range(300 if large else 30):
            item = AssetItem(kind='skill' if i % 3 == 0 else 'prompt', title=f'资产 {i:03}',
                category_id=category.id, content='正文 {{topic}}\n' * 4000, version=5,
                archive=(archive if i % 3 == 0 else None), archive_name='fixture.zip')
            session.add(item); session.flush(); asset_ids.append(item.id)
            session.execute(insert(AssetVersion), [{'item_id': item.id, 'version': version,
                'title': item.title, 'content': f'版本 {version}\n' + '版本内容\n' * 4000}
                for version in range(1, 6)])
            session.execute(insert(AssetFile), [{'item_id': item.id, 'path': f'docs/file-{j}.md',
                'content': '文件内容\n' * 100, 'size': 1000} for j in range(5)])
        session.execute(insert(Task), [{'id': f'qa-task-{i:06}', 'title': f'待办 {i:06}',
            'status': 'pending', 'is_important': True, 'is_urgent': False,
            'position': (i + 1) * 1024., 'created_at': now, 'updated_at': now, 'revision': 1}
            for i in range(50000 if large else 1000)])
        for i in range(10000 if large else 100):
            pid = f'qa-problem-{i:06}'
            session.add(PracticeProblem(id=pid, title=f'题目 {i:06}', source='other', difficulty=2,
                status='todo', description_md='题面\n' * 100, created_at=now, updated_at=now, revision=1))
            session.flush()
            for j in range(2):
                sid = f'qa-solution-{i:06}-{j}'
                session.add(PracticeSolution(id=sid, problem_id=pid, name=f'解法 {j}',
                    sort_order=float(j), revision=1, created_at=now, updated_at=now))
                session.flush()
                session.add(PracticeSolutionCode(id=f'qa-code-{i:06}-{j}', solution_id=sid,
                                                 language='python', code='print("fixture")'))
        for i in range(1000 if large else 151):
            member = SubsMember(name=f'会员 {i:04}', category_id=subs_category.id)
            session.add(member); session.flush()
            price = 99999 if i == 0 else i + 1
            session.add(SubsSubscription(member_id=member.id, price=Decimal(price), currency='CNY',
                billing_cycle='yearly', start_date='2026-01-01', end_date='2026-12-31'))
        session.commit()
        bookmarks = seed_bookmarks(engine, large=large)
        return {'workspace_id': workspace.id, 'post_id': post_id, 'journal_id': journal.id,
                'asset_id': asset_ids[0], 'asset_ids': asset_ids, 'subs_category_id': subs_category.id,
                'problem_id': 'qa-problem-000000', 'post_count': count, **bookmarks}


def seed_bookmarks(engine, *, large=False):
    """可以给已造好的 QA 库单独追加本域，固定 ID 使重复调用安全。"""
    from app.blog.bookmarks.models import BookmarkCategory, BookmarkItem
    now = datetime(2026, 10, 21, 4, 0, tzinfo=timezone.utc)
    category_id = 'qa-bookmarks-category'
    with Session(engine) as session:
        if session.get(BookmarkCategory, category_id):
            return {'bookmark_category_id': category_id, 'bookmark_id': 'qa-bookmark-000000'}
        session.add(BookmarkCategory(id=category_id, name='优化验收书签', sort_order=0,
            created_at=now))
        session.flush()
        session.execute(insert(BookmarkItem), [{'id': f'qa-bookmark-{i:06}',
            'category_id': category_id, 'url': f'https://example.org/quality/{i}',
            'normalized_url': f'https://example.org/quality/{i}', 'title': f'书签 {i:06}',
            'description': '离线固定语料，无需联网', 'status': 'unread', 'starred': False,
            'snapshot_md': '# 离线正文\n' + '正文和表格示例\n' * 5000,
            'snapshot_words': 35000, 'snapshot_at': now, 'created_at': now, 'updated_at': now}
            for i in range(10000 if large else 200)])
        session.commit()
    return {'bookmark_category_id': category_id, 'bookmark_id': 'qa-bookmark-000000'}
