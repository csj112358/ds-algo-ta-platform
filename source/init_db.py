"""初始化做题记录数据库 course.db（仓库不附带数据库文件，首次运行前执行一次）。

用法（在项目根目录执行）：
    python source/init_db.py

脚本是幂等的：表和演示学生已存在时不会重复创建，也不会清空已有数据。
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "core" / "database" / "course.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    question         TEXT,
    answer           TEXT,
    mastery          INTEGER,
    knowledge_points TEXT,
    student_id       INTEGER,
    created_at       TEXT DEFAULT (datetime('now','localtime'))
);
"""

# 演示学生（假名），方便开箱体验「切换学生 / 查做题记录」功能
DEMO_STUDENTS = ["xiaoming", "zhangsan"]


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connect = sqlite3.connect(str(DB_PATH))
    connect.executescript(SCHEMA)
    for name in DEMO_STUDENTS:
        exists = connect.execute(
            "select id from students where trim(name) = ?", (name,)
        ).fetchone()
        if not exists:
            connect.execute("insert into students (name) values (?)", (name,))
    connect.commit()
    rows = connect.execute("select id, name from students order by id").fetchall()
    connect.close()
    print(f"数据库已就绪：{DB_PATH}")
    for sid, name in rows:
        print(f"  学生 {sid}: {name}")


if __name__ == "__main__":
    main()