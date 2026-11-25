import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "database" / "course.db"


def connectdb():
    return sqlite3.connect(str(DB_PATH))


def list_students() -> list:
    connect = connectdb()
    connect.row_factory = sqlite3.Row
    rows = connect.execute("select id, name from students order by id").fetchall()
    connect.close()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def add_student(name: str):
    name = (name or "").strip()
    connect = connectdb()
    connect.row_factory = sqlite3.Row
    exists = connect.execute("select id, name from students where trim(name) = ?", (name,)).fetchone()
    if exists:
        connect.close()
        return {"id": exists["id"], "name": exists["name"]}
    cursor = connect.execute("insert into students (name) values (?)", (name,))
    new_id = cursor.lastrowid
    cursor.close()
    connect.commit()
    connect.close()
    return {"id": new_id, "name": name}
