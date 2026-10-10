"""gamemap 13 表模型(自 gamemap backend/app/models.py 逐列照搬;表名加 gamemap_ 前缀)。

列/索引/约束与源一致;仅表名与外键引用的目标表名随之改写(模块名_表名规范)。
"""
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Game(Base):
    __tablename__ = "gamemap_games"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    cover_attachment_id: Mapped[int | None] = mapped_column(ForeignKey("gamemap_attachments.id", use_alter=True))
    description: Mapped[str] = mapped_column(Text, default="")
    play_status: Mapped[str] = mapped_column(String(50), default="playing")  # playing / finished / planned
    current_chapter_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    chapters: Mapped[list["Chapter"]] = relationship(back_populates="game", order_by="Chapter.order_index")
    characters: Mapped[list["Character"]] = relationship(back_populates="game")


class Chapter(Base):
    __tablename__ = "gamemap_chapters"
    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("gamemap_games.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    game: Mapped[Game] = relationship(back_populates="chapters")
    board: Mapped["Board | None"] = relationship(back_populates="chapter", uselist=False)


class Character(Base):
    """游戏人物档案：同一游戏只创建一次，被各章节引用。"""
    __tablename__ = "gamemap_characters"
    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("gamemap_games.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    avatar_url: Mapped[str] = mapped_column(String(500), default="")
    avatar_attachment_id: Mapped[int | None] = mapped_column(ForeignKey("gamemap_attachments.id", use_alter=True))
    description: Mapped[str] = mapped_column(Text, default="")
    faction: Mapped[str] = mapped_column(String(200), default="")  # 阵营名称，空为无阵营
    alive: Mapped[bool] = mapped_column(Boolean, default=True)  # 生死状态
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    game: Mapped[Game] = relationship(back_populates="characters")
    chapter_states: Mapped[list["ChapterCharacter"]] = relationship(back_populates="character")


class ChapterCharacter(Base):
    """人物在某一章节的状态：称呼、身份、备注等阶段性信息。

    alive_override / faction_override 为 NULL 时跟随人物档案；
    生死/阵营因此可以随剧情演进（第5章死亡的角色，回看第3章仍是存活）。"""
    __tablename__ = "gamemap_chapter_characters"
    __table_args__ = (UniqueConstraint("chapter_id", "character_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("gamemap_chapters.id"), index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)
    alias: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(200), default="")  # 本章身份
    status: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    alive_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    faction_override: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    character: Mapped[Character] = relationship(back_populates="chapter_states")


class CharacterPhoto(Base):
    """角色图鉴照片：按章节归档的角色截图/立绘，文件本体存 attachments。"""
    __tablename__ = "gamemap_character_photos"
    id: Mapped[int] = mapped_column(primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("gamemap_chapters.id"), index=True)  # NULL=通用（不归属章节）
    attachment_id: Mapped[int] = mapped_column(ForeignKey("gamemap_attachments.id"))
    caption: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Board(Base):
    __tablename__ = "gamemap_boards"
    id: Mapped[int] = mapped_column(primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("gamemap_chapters.id"), unique=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)  # 乐观锁，防止多标签页覆盖
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # 视口等展示信息

    chapter: Mapped["Chapter"] = relationship(back_populates="board", uselist=False)

    nodes: Mapped[list["BoardNode"]] = relationship(back_populates="board", cascade="all, delete-orphan")
    relations: Mapped[list["ChapterRelation"]] = relationship(back_populates="board", cascade="all, delete-orphan")


class BoardNode(Base):
    __tablename__ = "gamemap_board_nodes"
    __table_args__ = (UniqueConstraint("board_id", "character_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("gamemap_boards.id"), index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=80)

    board: Mapped[Board] = relationship(back_populates="nodes")


class RelationType(Base):
    """关系类型：game_id 为空表示全局默认，否则为游戏自定义。"""
    __tablename__ = "gamemap_relation_types"
    __table_args__ = (UniqueConstraint("game_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int | None] = mapped_column(ForeignKey("gamemap_games.id"), index=True)
    key: Mapped[str] = mapped_column(String(100), index=True)  # 稳定标识，如 friend
    name: Mapped[str] = mapped_column(String(200))  # 显示名称
    color: Mapped[str] = mapped_column(String(50), default="#5B8FF9")
    line_style: Mapped[str] = mapped_column(String(20), default="solid")  # solid / dashed
    directional: Mapped[bool] = mapped_column(Boolean, default=False)
    default_description: Mapped[str] = mapped_column(Text, default="")
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    overrides: Mapped[list["GameRelationOverride"]] = relationship(
        back_populates="relation_type", cascade="all, delete-orphan"
    )


class GameRelationOverride(Base):
    """游戏对全局类型的字段覆盖：只存被覆盖的字段。"""
    __tablename__ = "gamemap_game_relation_overrides"
    __table_args__ = (UniqueConstraint("game_id", "relation_type_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("gamemap_games.id"), index=True)
    relation_type_id: Mapped[int] = mapped_column(ForeignKey("gamemap_relation_types.id"), index=True)
    fields: Mapped[dict] = mapped_column(JSON, default=dict)  # {"name": "...", "color": "..."}

    relation_type: Mapped[RelationType] = relationship(back_populates="overrides")


class ChapterRelation(Base):
    """本章人物关系实例。"""
    __tablename__ = "gamemap_chapter_relations"
    __table_args__ = (UniqueConstraint("board_id", "from_character_id", "to_character_id", "relation_type_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("gamemap_boards.id"), index=True)
    from_character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)
    to_character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)
    relation_type_id: Mapped[int] = mapped_column(ForeignKey("gamemap_relation_types.id"), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    event_ids: Mapped[list] = mapped_column(JSON, default=list)  # 关联剧情事件

    board: Mapped[Board] = relationship(back_populates="relations")


class StoryEvent(Base):
    __tablename__ = "gamemap_story_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("gamemap_chapters.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class EventCharacter(Base):
    __tablename__ = "gamemap_event_characters"
    __table_args__ = (UniqueConstraint("event_id", "character_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("gamemap_story_events.id"), index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("gamemap_characters.id"), index=True)


class Attachment(Base):
    __tablename__ = "gamemap_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_path: Mapped[str] = mapped_column(String(500))
    file_name: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
