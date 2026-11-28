from pydantic import Field
from sqlalchemy import select

from app.shared.mcp_read import IntId, Paged, Search, one_row, page_rows, read_provider, read_tool
from .models import Chapter, ChapterCharacter, Character, Game, StoryEvent


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
