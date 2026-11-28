from typing import Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import select

from app.db import db
from app.shared.mcp_read import IntId, Paged, Search, one_row, page_rows, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, write_tool
from . import cache
from .models import Chapter, ChapterCharacter, Character, Game, StoryEvent
from .routers.chapters import create_chapter_record, edit_chapter_record
from .routers.games import save_game_record
from .schemas import ChapterCreate


class GameRead(Paged):
    game_id: IntId = Field(description='游戏 ID，从游戏列表中获取。', examples=[1])


class ChapterRead(Paged):
    chapter_id: IntId = Field(description='章节 ID，从章节列表中获取。', examples=[1])


def search_games(args):
    """查游戏或剧集，返回游玩状态和当前章节。"""
    query = select(Game.id, Game.name, Game.description, Game.play_status, Game.current_chapter_id, Game.updated_at)
    if args.keyword:
        query = query.where(Game.name.icontains(args.keyword, autoescape=True))
    return page_rows(query.order_by(Game.updated_at.desc(), Game.id.desc()), args)


def list_chapters(args):
    """按剧情顺序分页返回指定游戏的章节和摘要。"""
    game = one_row(select(Game.id, Game.name).where(Game.id == args.game_id), '游戏不存在')
    query = select(Chapter.id, Chapter.title, Chapter.order_index, Chapter.summary).where(Chapter.game_id == args.game_id)
    return {'game': game, **page_rows(query.order_by(Chapter.order_index, Chapter.id), args)}


def get_chapter_brief(args):
    """查看章节摘要，两组分页同时返回事件和登场人物。"""
    chapter = one_row(select(Chapter.id, Chapter.game_id, Chapter.title, Chapter.summary, Chapter.notes)
                      .where(Chapter.id == args.chapter_id), '章节不存在')
    events = (select(StoryEvent.id, StoryEvent.title, StoryEvent.order_index).where(StoryEvent.chapter_id == args.chapter_id)
              .order_by(StoryEvent.order_index, StoryEvent.id))
    characters = (select(Character.id, Character.name, ChapterCharacter.alias, ChapterCharacter.role, ChapterCharacter.status)
                  .join(ChapterCharacter, Character.id == ChapterCharacter.character_id)
                  .where(ChapterCharacter.chapter_id == args.chapter_id).order_by(ChapterCharacter.id))
    return {'chapter': chapter, 'events': page_rows(events, args), 'characters': page_rows(characters, args)}


mcp_provider = read_provider('剧情图谱', 'gamemap', '从游戏目录定位章节，查看剧情和登场人物。', {
    'search_games': read_tool('查找游戏', '剧情与人物', Search, search_games),
    'list_chapters': read_tool('列出章节', '剧情与人物', GameRead, list_chapters),
    'get_chapter_brief': read_tool('查看章节摘要', '剧情与人物', ChapterRead, get_chapter_brief),
})


class GameSave(Write):
    game_id: IntId | None = Field(default=None, description='要编辑的游戏 ID，省略时新建。', examples=[1])
    name: str | None = Field(default=None, min_length=1, max_length=200, description='游戏名称，新建时必填。', examples=['海外城镇'])
    description: str | None = Field(default=None, max_length=10000, description='游戏简介。', examples=['记录主线进度'])
    play_status: Literal['playing', 'finished', 'planned'] | None = Field(
        default=None, description='游玩进度。', examples=['playing'])


class ChapterSave(Write):
    game_id: IntId = Field(description='章节所属游戏 ID。', examples=[1])
    chapter_id: IntId | None = Field(default=None, description='要编辑的章节 ID，省略时追加。', examples=[1])
    title: str | None = Field(default=None, min_length=1, max_length=200, description='章节标题，新建时必填。', examples=['城镇初见'])
    summary: str | None = Field(default=None, max_length=10000, description='剧情摘要。', examples=['旅人进城'])
    notes: str | None = Field(default=None, max_length=10000, description='章节笔记。', examples=['留意旅店人物'])


def save_game(args):
    """新建游戏，或更新已有游戏的名称、简介和进度。"""
    fields = args.model_dump(exclude_unset=True, exclude_none=True, exclude={'game_id', 'mutation_id'})
    if args.game_id is None and 'name' not in fields:
        raise HTTPException(400, '新建游戏必须提供名称')
    game = save_game_record(db.session, args.game_id, fields)
    return {'game_id': game.id, 'name': game.name, 'description': game.description,
            'play_status': game.play_status}


def save_chapter(args):
    """追加章节并建立画板，或更新现有章节的文字资料。"""
    fields = args.model_dump(exclude_unset=True, exclude_none=True, exclude={'game_id', 'chapter_id', 'mutation_id'})
    if args.chapter_id is None:
        if 'title' not in fields:
            raise HTTPException(400, '新建章节必须提供标题')
        chapter = create_chapter_record(db.session, args.game_id, ChapterCreate(**fields))
    else:
        chapter = edit_chapter_record(db.session, args.game_id, args.chapter_id, fields)
    return {'id': chapter.id, 'game_id': chapter.game_id, 'title': chapter.title, 'order_index': chapter.order_index}


def _invalidate_game(result):
    cache.invalidate_game(result['game_id'])


mcp_provider = add_writes(mcp_provider, {
    'save_game': write_tool('保存游戏资料', '图谱编辑', GameSave, save_game, after_commit=lambda _: cache.invalidate_all()),
    'save_chapter': write_tool('保存章节资料', '图谱编辑', ChapterSave, save_chapter, after_commit=_invalidate_game),
})
