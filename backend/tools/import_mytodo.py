"""MyTodo → DouBlog todo_* 数据导入脚本(docs/todo-migration.md 第 4 节)。

用法(backend 目录下):
    ./venv/Scripts/python.exe tools/import_mytodo.py              # 目标 todo_tasks 为空才导
    ./venv/Scripts/python.exe tools/import_mytodo.py --force      # 清空目标 todo_* 五表后重导
    ./venv/Scripts/python.exe tools/import_mytodo.py --source <mytodo.db 路径>

行为:
- 源库 WAL 活跃:先 copy 到临时文件再读,避免读到半写状态
- 目标 = Doublog 当前库(data/db_config.json 决定,SQLite / PostgreSQL 均可)
- 表映射 categories→todo_categories / tasks→todo_tasks / task_events→todo_task_events
  / app_settings→todo_app_settings / plans→todo_plans;users 整表丢弃
- 字段一一对应直拷(uuid 主键不变),datetime 统一补 UTC 时区(PG timestamptz 安全)
- 幂等:默认仅当目标 todo_tasks 为空时导入;--force 先清空五表
- 完成后打印各表行数校验(源==目标;规范期望 tasks=2500 events=5695
  categories=4 settings=1 plans=0)
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

# 脚本位于 backend/tools/,让 `import app.*` 可用
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import MetaData, create_engine, delete, func, select  # noqa: E402

DEFAULT_SOURCE = r"C:\Users\Lizy\Desktop\Code\MyTodo\backend\data\todo.db"

#: 源表 → 目标表(顺序满足外键依赖:events 依赖 tasks)
TABLE_MAP = [
    ("categories", "todo_categories"),
    ("tasks", "todo_tasks"),
    ("task_events", "todo_task_events"),
    ("app_settings", "todo_app_settings"),
    ("plans", "todo_plans"),
]

#: 规范第 4 节的期望行数(仅参考输出;校验口径 = 源==目标)
EXPECTED_COUNTS = {"todo_tasks": 2500, "todo_task_events": 5695,
                   "todo_categories": 4, "todo_app_settings": 1, "todo_plans": 0}


def _aware(v):
    """SQLite 读出的 naive datetime 一律视为 UTC(PG timestamptz 插入安全)。"""
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


def _copy_source(source: str) -> str:
    """源库 WAL 活跃:拷贝到临时文件再读(避免读半写状态/锁冲突)。"""
    if not os.path.isfile(source):
        print(f"[错误] 源库不存在: {source}")
        sys.exit(1)
    fd, tmp = tempfile.mkstemp(prefix="mytodo-import-", suffix=".db")
    os.close(fd)
    shutil.copy2(source, tmp)
    return tmp


def main() -> None:
    ap = argparse.ArgumentParser(description="导入 MyTodo 数据到 DouBlog todo_* 表")
    ap.add_argument("--source", default=DEFAULT_SOURCE, help=f"MyTodo todo.db 路径(默认 {DEFAULT_SOURCE})")
    ap.add_argument("--force", action="store_true", help="目标 todo_* 五表非空时先清空再导入")
    args = ap.parse_args()

    tmp = _copy_source(args.source)
    src_engine = create_engine(f"sqlite:///{tmp}")

    try:
        # 目标库 = Doublog 当前库(db_config 决定);注册 todo 模型并确保建表
        from app.db import Base, rebuild_engine
        import app.todo  # noqa: F401 - 注册 todo_* 模型

        engine = rebuild_engine()
        Base.metadata.create_all(engine)
        target_name = engine.url.get_backend_name()
        print(f"[目标] {target_name}: {engine.url.render_as_string(hide_password=True)}")

        # 幂等检查
        tgt_meta = MetaData()
        tgt_meta.reflect(bind=engine, only=[t for _, t in TABLE_MAP])
        tgt_tables = {t.name: t for t in tgt_meta.tables.values()}
        with engine.connect() as conn:
            existing = {
                tgt: conn.execute(select(func.count()).select_from(tgt_tables[tgt])).scalar() or 0
                for _, tgt in TABLE_MAP
            }
        if existing["todo_tasks"] and not args.force:
            print(f"[跳过] 目标 todo_tasks 已有 {existing['todo_tasks']} 行(非空)。"
                  f"如需覆盖请加 --force(将清空 todo_* 五表后重导)。")
            return
        if args.force:
            with engine.begin() as conn:  # 逆序清空(events 依赖 tasks)
                for _, tgt in reversed(TABLE_MAP):
                    conn.execute(delete(tgt_tables[tgt]))
                print("[清空] todo_* 五表已按 --force 清空")

        # 源表反射 + 逐表复制
        src_meta = MetaData()
        src_meta.reflect(bind=src_engine)
        src_counts, tgt_counts = {}, {}
        with engine.begin() as conn:
            for src_name, tgt_name_ in TABLE_MAP:
                if src_name not in src_meta.tables:
                    src_counts[tgt_name_] = 0
                    tgt_counts[tgt_name_] = 0
                    print(f"[警告] 源库缺表 {src_name},跳过(按 0 计)")
                    continue
                src_tbl, tgt_tbl = src_meta.tables[src_name], tgt_tables[tgt_name_]
                with src_engine.connect() as sconn:
                    rows = [
                        {c: _aware(v) for c, v in row.items()}
                        for row in sconn.execute(src_tbl.select()).mappings()
                    ]
                src_counts[tgt_name_] = len(rows)
                if rows:
                    conn.execute(tgt_tbl.insert(), rows)
                tgt_counts[tgt_name_] = (
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
        match = "OK" if src_counts[tgt] == tgt_counts[tgt] else "MISMATCH"
        ok = ok and match == "OK"
        print(f"  {tgt:<18} {src_counts[tgt]:>6} → {tgt_counts[tgt]:>6}  (期望 {exp})  {match}")
    print(f"\n[{'完成' if ok else '失败'}] users 表按规范丢弃;校验口径 = 源行数 == 目标行数。")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
