"""pydantic 模型(自 gamemap backend/app/schemas.py 照搬,无改动)。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 游戏 ----
class GameCreate(BaseModel):
    name: str
    description: str = ""
    play_status: str = "playing"


class GameUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    play_status: str | None = None
    current_chapter_id: int | None = None
    cover_attachment_id: int | None = None


class GameOut(ORMModel):
    id: int
    name: str
    description: str
    play_status: str
    current_chapter_id: int | None
    cover_url: str = ""
    created_at: datetime
    updated_at: datetime


# ---- 章节 ----
class ChapterCreate(BaseModel):
    title: str
    summary: str = ""
    notes: str = ""
    copy_from_previous: bool = False


class ChapterUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    notes: str | None = None
    order_index: int | None = None


class ChapterOut(ORMModel):
    id: int
    game_id: int
    title: str
    order_index: int
    summary: str
    notes: str


# ---- 人物 ----
class CharacterCreate(BaseModel):
    name: str
    description: str = ""
    avatar_url: str = ""
    faction: str = ""
    alive: bool = True


class CharacterUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    avatar_url: str | None = None
    faction: str | None = None
    alive: bool | None = None


class CharacterOut(ORMModel):
    id: int
    game_id: int
    name: str
    avatar_url: str = ""
    description: str
    faction: str = ""
    alive: bool = True
    updated_at: datetime


class CharacterBatchCreate(BaseModel):
    names: str  # 换行或顿号/逗号分隔的人物名
    add_to_chapter_id: int | None = None  # 提供则同时把这些人物加到该章看板


class ChapterCharacterUpdate(BaseModel):
    alias: str | None = None
    role: str | None = None
    status: str | None = None
    notes: str | None = None
    alive_override: bool | None = None      # 显式 null = 跟随档案
    faction_override: str | None = None     # 显式 null/空 = 跟随档案


class ChapterCharacterOut(ORMModel):
    id: int
    chapter_id: int
    character_id: int
    alias: str
    role: str
    status: str
    notes: str
    alive_override: bool | None = None
    faction_override: str | None = None


# ---- 角色图鉴照片 ----
class CharacterPhotoCreate(BaseModel):
    attachment_id: int
    chapter_id: int | None = None
    caption: str = ""


class CharacterPhotoUpdate(BaseModel):
    chapter_id: int | None = None
    caption: str | None = None


class CharacterPhotoOut(BaseModel):
    id: int
    character_id: int
    chapter_id: int | None
    chapter_title: str = ""
    chapter_order: int = 0
    url: str
    caption: str
    created_at: datetime


# ---- 看板 ----
class NodeIn(BaseModel):
    character_id: int
    x: float = 0
    y: float = 0
    width: float = 180
    height: float = 80


class NodeOut(NodeIn):
    id: int
    board_id: int


class RelationIn(BaseModel):
    from_character_id: int
    to_character_id: int
    relation_type_id: int
    description: str = ""
    event_ids: list[int] = []


class RelationOut(RelationIn):
    id: int
    board_id: int


class RelationTypeOut(ORMModel):
    id: int
    game_id: int | None
    key: str
    name: str
    color: str
    line_style: str
    directional: bool
    default_description: str
    order_index: int
    enabled: bool


class RelationTypeCreate(BaseModel):
    game_id: int | None = None  # 空 = 全局默认，否则为游戏自定义
    key: str
    name: str = ""  # 缺省用 key
    color: str = "#5B8FF9"
    line_style: str = "solid"
    directional: bool = False
    default_description: str = ""
    order_index: int = 0


class EffectiveRelationType(RelationTypeOut):
    overridden: bool = False  # 是否被游戏覆盖


class BoardSave(BaseModel):
    version: int
    nodes: list[NodeIn]
    relations: list[RelationIn]


class BoardOut(BaseModel):
    id: int
    chapter_id: int
    version: int
    nodes: list[NodeOut]
    relations: list[RelationOut]
    characters: list[CharacterOut]
    states: list[ChapterCharacterOut] = []


# ---- 跨章节聚合视图 ----
class MergedNodeOut(BaseModel):
    character_id: int
    x: float
    y: float
    chapter_id: int  # 位置/状态取自的章节（所选范围内最新包含该人物的章节）


class MergedRelationOut(BaseModel):
    id: int
    chapter_id: int
    chapter_title: str
    from_character_id: int
    to_character_id: int
    relation_type_id: int
    description: str = ""


class MergedStateOut(BaseModel):
    character_id: int
    chapter_id: int
    alias: str = ""
    role: str = ""
    status: str = ""
    alive: bool | None = None  # 构建时填覆盖值，返回前按"覆盖 > 档案"解析
    faction: str = ""


class MergedBoardOut(BaseModel):
    chapters: list[ChapterOut]
    anchor_chapter_id: int | None = None  # 所选范围内最后一章：聚合模式下的写入目标
    nodes: list[MergedNodeOut]
    relations: list[MergedRelationOut]
    characters: list[CharacterOut]
    states: list[MergedStateOut]


class NodePositionUpdate(BaseModel):
    x: float
    y: float


class RelationCreate(BaseModel):
    from_character_id: int
    to_character_id: int
    relation_type_id: int
    description: str = ""
    # 端点人物若不在目标看板上，会以该坐标自动补入节点
    from_x: float | None = None
    from_y: float | None = None
    to_x: float | None = None
    to_y: float | None = None


class RelationDescriptionUpdate(BaseModel):
    description: str | None = None


# ---- 剧情事件 ----
class EventCreate(BaseModel):
    title: str
    content: str = ""
    order_index: int = 0
    character_ids: list[int] = []


class EventUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    order_index: int | None = None
    character_ids: list[int] | None = None


class EventOut(ORMModel):
    id: int
    chapter_id: int
    title: str
    order_index: int
    content: str
    character_ids: list[int] = []
    updated_at: datetime


# ---- 搜索 ----
class SearchHit(BaseModel):
    game_id: int
    chapter_id: int | None
    kind: str  # game / chapter / character / relation / event
    title: str
    snippet: str
    ref_id: int
