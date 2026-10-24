"""Delete owned graph rows in FK order, in the caller's transaction.

Uploaded attachment files may be shared and are retained; only associations go.
"""
from sqlalchemy import select
from .models import (Board, BoardNode, Chapter, ChapterCharacter, ChapterRelation,
                     Character, CharacterPhoto, EventCharacter, Game,
                     GameRelationOverride, PositionMutation, RelationType, StoryEvent)


def delete_chapters(session, game_id, chapter_ids):
    board_ids = select(Board.id).where(Board.chapter_id.in_(chapter_ids))
    event_ids = select(StoryEvent.id).where(StoryEvent.chapter_id.in_(chapter_ids))
    session.query(EventCharacter).filter(EventCharacter.event_id.in_(event_ids)).delete(synchronize_session=False)
    session.query(StoryEvent).filter(StoryEvent.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
    session.query(CharacterPhoto).filter(CharacterPhoto.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
    session.query(ChapterCharacter).filter(ChapterCharacter.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
    session.query(ChapterRelation).filter(ChapterRelation.board_id.in_(board_ids)).delete(synchronize_session=False)
    session.query(BoardNode).filter(BoardNode.board_id.in_(board_ids)).delete(synchronize_session=False)
    session.query(Board).filter(Board.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
    session.query(Game).filter(Game.id == game_id, Game.current_chapter_id.in_(chapter_ids)).update(
        {Game.current_chapter_id: None}, synchronize_session=False)
    session.query(Chapter).filter(Chapter.id.in_(chapter_ids), Chapter.game_id == game_id).delete(synchronize_session=False)
    session.query(PositionMutation).filter(PositionMutation.game_id == game_id).delete(synchronize_session=False)


def delete_game_rows(session, game_id):
    chapter_ids = select(Chapter.id).where(Chapter.game_id == game_id)
    delete_chapters(session, game_id, chapter_ids)
    character_ids = select(Character.id).where(Character.game_id == game_id)
    session.query(CharacterPhoto).filter(CharacterPhoto.character_id.in_(character_ids)).delete(synchronize_session=False)
    session.query(ChapterCharacter).filter(ChapterCharacter.character_id.in_(character_ids)).delete(synchronize_session=False)
    session.query(EventCharacter).filter(EventCharacter.character_id.in_(character_ids)).delete(synchronize_session=False)
    session.query(Character).filter(Character.game_id == game_id).delete(synchronize_session=False)
    session.query(GameRelationOverride).filter(GameRelationOverride.game_id == game_id).delete(synchronize_session=False)
    session.query(RelationType).filter(RelationType.game_id == game_id).delete(synchronize_session=False)
    session.query(Game).filter(Game.id == game_id).delete(synchronize_session=False)
