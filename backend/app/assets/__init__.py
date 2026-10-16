"""Prompt 与 Skill 资产库能力。"""
from fastapi import APIRouter

from .routes import router as assets_router

router = APIRouter()
router.include_router(assets_router)

__all__ = ['router']


def ensure_migrations(engine):
    """幂等迁移钩子（新模块，表由 create_all 建立；存量列变更在 此 追加）。"""
