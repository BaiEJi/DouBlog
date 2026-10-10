"""gamemap → DouBlog gamemap_* 数据导入脚本(docs/gamemap-migration.md 第 2 节)。

用法(backend 目录下):
    ./venv/Scripts/python.exe tools/import_gamemap.py              # 目标 gamemap_games 为空才导
    ./venv/Scripts/python.exe tools/import_gamemap.py --force      # 清空目标 gamemap_* 13 表后重导
    ./venv/Scripts/python.exe tools/import_gamemap.py --source <gamemap.db> --attachments <PNG 目录>

行为:
- 源库 WAL 活跃:先 copy 到临时文件再读,避免读到半写状态
- 目标 = Doublog 当前库(data/db_config.json 决定,SQLite / PostgreSQL 均可)+
  <data_dir>/gamemap_attachments/(32 张 PNG 照搬,UUID 文件名不变)
- 表映射 games→gamemap_games 等 13 表(见 TABLE_MAP,顺序满足外键依赖;主键 id 直拷,
  引用关系随 id 原样保留);唯一改写:gamemap_attachments.file_path 指向目标附件目录
  (URL 生成只取 basename,行为不受影响)
- 导入即整组替换:通过空库检查(gamemap_games 为空,或 --force)后先清空 13 表
  (含 ensure_migrations 种子的 7 个全局关系类型,源库同样带这 7 条,id 一致按源为准)
- 幂等:默认仅当目标 gamemap_games 为空时导入
- 完成后打印 13 表行数校验(源==目标;规范期望 13 游戏/27 章/41 人物/27 板/
  39 关系/32 附件/7 关系类型,以源实际为准)
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile

# 脚本位于 backend/tools/,让 `import app.*` 可用
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import MetaData, create_engine, delete, func, select  # noqa: E402

DEFAULT_SOURCE = r"C:\Users\Lizy\Desktop\Code\gamemap\backend\gamemap.db"
DEFAULT_ATTACHMENTS = r"C:\Users\Lizy\Desktop\Code\gamemap\backend\app\attachments"

#: 源表 → 目标表(顺序满足外键依赖)
TABLE_MAP = [
    ("attachments", "gamemap_attachments"),
    ("games", "gamemap_games"),
    ("relation_types", "gamemap_relation_types"),
    ("chapters", "gamemap_chapters"),
    ("characters", "gamemap_characters"),
    ("boards", "gamemap_boards"),
    ("board_nodes", "gamemap_board_nodes"),
    ("chapter_characters", "gamemap_chapter_characters"),
    ("character_photos", "gamemap_character_photos"),
    ("game_relation_overrides", "gamemap_game_relation_overrides"),
    ("chapter_relations", "gamemap_chapter_relations"),
    ("story_events", "gamemap_story_events"),
    ("event_characters", "gamemap_event_characters"),
]

#: 规范第 2 节的期望行数(仅参考输出;校验口径 = 源==目标)
EXPECTED_COUNTS = {
    "gamemap_games": 13, "gamemap_chapters": 27, "gamemap_characters": 41,
    "gamemap_boards": 27, "gamemap_chapter_relations": 39,
    "gamemap_attachments": 32, "gamemap_relation_types": 7,
}


def _copy_source(source: str) -> str:
    """源库 WAL 活跃:拷贝到临时文件再读(避免读半写状态/锁冲突)。"""
    if not os.path.isfile(source):
        print(f"[错误] 源库不存在: {source}")
        sys.exit(1)
    fd, tmp = tempfile.mkstemp(prefix="gamemap-import-", suffix=".db")
    os.close(fd)
    shutil.copy2(source, tmp)
    return tmp


def _copy_attachments(src_dir: str, dst_dir: str) -> int:
    """源附件目录 PNG 照搬到目标附件目录(UUID 文件名不变,覆盖写)。"""
    if not os.path.isdir(src_dir):
        print(f"[警告] 源附件目录不存在: {src_dir}(跳过文件复制)")
        return 0
    os.makedirs(dst_dir, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(src_dir)):
        s = os.path.join(src_dir, name)
        if os.path.isfile(s) and os.path.splitext(name)[1].lower() == ".png":
            shutil.copy2(s, os.path.join(dst_dir, name))
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="导入 gamemap 数据到 DouBlog gamemap_* 13 表")
    ap.add_argument("--source", default=DEFAULT_SOURCE, help=f"源 gamemap.db 路径(默认 {DEFAULT_SOURCE})")
    ap.add_argument("--attachments", default=DEFAULT_ATTACHMENTS,
                    help=f"源附件 PNG 目录(默认 {DEFAULT_ATTACHMENTS})")
    ap.add_argument("--force", action="store_true", help="目标 gamemap_games 非空时仍清空 13 表重导")
    args = ap.parse_args()

    tmp = _copy_source(args.source)
    src_engine = create_engine(f"sqlite:///{tmp}")

    try:
        # 目标库 = Doublog 当前库(db_config 决定);注册 gamemap 模型并确保建表
        from app.db import Base, rebuild_engine
        import app.todo  # noqa: F401 - 注册 todo_* + gamemap_* 模型

        engine = rebuild_engine()
        Base.metadata.create_all(engine)
        print(f"[目标] {engine.url.get_backend_name()}: {engine.url.render_as_string(hide_password=True)}")

        # 幂等检查:目标 gamemap_games 为空才导(--force 跳过)
        tgt_meta = MetaData()
        tgt_meta.reflect(bind=engine, only=[t for _, t in TABLE_MAP])
        tgt_tables = {t.name: t for t in tgt_meta.tables.values()}
        with engine.connect() as conn:
            existing_games = conn.execute(
                select(func.count()).select_from(tgt_tables["gamemap_games"])).scalar() or 0
        if existing_games and not args.force:
            print(f"[跳过] 目标 gamemap_games 已有 {existing_games} 行(非空)。"
                  f"如需覆盖请加 --force(将清空 gamemap_* 13 表后重导)。")
            return

        # 附件文件先复制(失败不阻断,行数对照会暴露缺额)
        from app.todo.gamemap.attachments import attachment_dir
        att_dir = str(attachment_dir())
        files_copied = _copy_attachments(args.attachments, att_dir)
        print(f"[附件] {files_copied} 个 PNG → {att_dir}")

        # 清空 13 表(逆外键序)后按源整组导入
        src_meta = MetaData()
        src_meta.reflect(bind=src_engine)
        src_counts, tgt_counts = {}, {}
        with engine.begin() as conn:
            for _, tgt in reversed(TABLE_MAP):
                conn.execute(delete(tgt_tables[tgt]))
            print("[清空] gamemap_* 13 表已清空(含 ensure_migrations 种子的 7 全局关系类型,"
                  "导入后以源库同内容为准)")
            for src_name, tgt_name in TABLE_MAP:
                if src_name not in src_meta.tables:
                    src_counts[tgt_name] = 0
                    tgt_counts[tgt_name] = 0
                    print(f"[警告] 源库缺表 {src_name},按 0 计")
                    continue
                src_tbl, tgt_tbl = src_meta.tables[src_name], tgt_tables[tgt_name]
                with src_engine.connect() as sconn:
                    rows = [dict(row) for row in sconn.execute(src_tbl.select()).mappings()]
                if src_name == "attachments":
                    # file_path 改写为目标附件目录(取 basename;URL 生成只用 basename)
                    for row in rows:
                        base = str(row["file_path"]).replace("\\", "/").split("/")[-1]
                        row["file_path"] = os.path.join(att_dir, base)
                src_counts[tgt_name] = len(rows)
                if rows:
                    conn.execute(tgt_tbl.insert(), rows)
                tgt_counts[tgt_name] = (
                    conn.execute(select(func.count()).select_from(tgt_tbl)).scalar() or 0
                )
    finally:
        src_engine.dispose()
        os.unlink(tmp)

    # 行数校验输出
    print("\n===== 导入校验(源 → 目标 / 规范期望)=====")
    ok = True
    for _, tgt in TABLE_MAP:
        exp = EXPECTED_COUNTS.get(tgt)
        exp_s = str(exp) if exp is not None else "-"
        match = "OK" if src_counts[tgt] == tgt_counts[tgt] else "MISMATCH"
        ok = ok and match == "OK"
        print(f"  {tgt:<32} {src_counts[tgt]:>6} → {tgt_counts[tgt]:>6}  (期望 {exp_s})  {match}")
    print(f"\n[{'完成' if ok else '失败'}] 附件文件 {files_copied} 个(期望 32);"
          f"校验口径 = 源行数 == 目标行数。")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
