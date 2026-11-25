"""网页与 MCP 共用类别管理；事务提交和看板缓存失效由调用方负责。"""
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.shared.timeutil import now_utc, uuid7
from ..models import Category, Plan, Task
from ..schemas import CategoryCreate, CategoryOut, CategoryUpdate
from .tasks import ACTIVE_STATUSES


def _with_count(category, count):
    result = CategoryOut.model_validate(category)
    result.task_count = count
    return result


def _active_counts(session, category_id=None):
    stmt = select(Task.category_id, func.count()).where(
        Task.deleted_at.is_(None), Task.status.in_(ACTIVE_STATUSES), Task.category_id.is_not(None)
    ).group_by(Task.category_id)
    if category_id is not None:
        stmt = stmt.where(Task.category_id == category_id)
    return dict(session.execute(stmt).all())


def list_categories(session: Session, include_archived: bool = False) -> list[CategoryOut]:
    stmt = select(Category).order_by(Category.sort_order, Category.created_at, Category.id)
    if not include_archived:
        stmt = stmt.where(Category.is_archived.is_(False))
    counts = _active_counts(session)
    return [_with_count(category, counts.get(category.id, 0)) for category in session.scalars(stmt)]


def create_category(session: Session, body: CategoryCreate) -> CategoryOut:
    now = now_utc()
    category = Category(id=uuid7(), name=body.name, color=body.color, icon=body.icon,
                        sort_order=body.sort_order, is_archived=False, created_at=now, updated_at=now)
    session.add(category)
    session.flush()
    return _with_count(category, 0)


def update_category(session: Session, category_id: str, body: CategoryUpdate) -> CategoryOut:
    fields = body.model_dump(include=set(CategoryUpdate.model_fields), exclude_unset=True)
    changes = {key: value for key, value in fields.items() if value is not None or key == 'icon'}
    category = session.scalar(update(Category).where(Category.id == category_id)
                              .values(**changes, updated_at=now_utc()).returning(Category))
    if category is None:
        raise HTTPException(404, '类别不存在')
    return _with_count(category, _active_counts(session, category_id).get(category_id, 0))


def delete_category(session: Session, category_id: str) -> dict:
    category = session.get(Category, category_id, with_for_update=True)
    if category is None:
        raise HTTPException(404, '类别不存在')
    now = now_utc()
    detached = session.scalars(update(Task).where(Task.category_id == category_id).values(
        category_id=None, revision=Task.revision + 1, updated_at=now).returning(Task.deleted_at.is_(None)))
    moved = sum(detached)
    # 计划类别是普通字符串，显式清理，后续生成的实例也会归入未分类。
    session.execute(update(Plan).where(Plan.category_id == category_id).values(category_id=None, updated_at=now))
    session.delete(category)
    session.flush()
    return {'ok': True, 'moved_to_uncategorized': moved}
