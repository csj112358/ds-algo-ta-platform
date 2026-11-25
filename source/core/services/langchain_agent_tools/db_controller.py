import datetime
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "database" / "course.db"


def connectdb():
    return sqlite3.connect(str(DB_PATH))


def getbyid(id: int) -> list:
    """取出学号为id的问题列表，最后一列的 created_at 是题目写入时间"""
    connect = connectdb()
    execute = connect.execute("select * from questions where student_id = ?", (id,))
    return execute.fetchall()


def addquestionbyid(question: str,answer: str,mastery: int,knowledge_points: str,student_id: int,created_at: str = "",):
    """根据课程ID添加问题，同时把写入时间一并存入 created_at（不传则取服务器当前时间）。
    返回写入结果的确认文本（含新记录 id 与 created_at），供 Agent 向学生复述。
    """
    connect = connectdb()
    if created_at:
        cursor = connect.execute(
            "insert into questions (question, answer, mastery, knowledge_points, student_id, created_at) "
                "values (?, ?, ?, ?, ?, ?)",
                (question, answer, mastery, knowledge_points, student_id, created_at))
    else:
        cursor = connect.execute(
            "insert into questions (question, answer, mastery, knowledge_points, student_id) "
                "values (?, ?, ?, ?, ?)",
                (question, answer, mastery, knowledge_points, student_id))
    new_id = cursor.lastrowid
    cursor.close()
    connect.commit()
    saved_at = connect.execute(
        "select created_at from questions where id = ?", (new_id,)
    ).fetchone()[0]
    connect.close()
    return (
        f"已写入数据库：记录 id={new_id}｜题目「{question}」｜掌握度 {mastery}"
        f"｜知识点 {knowledge_points}｜学生 {student_id}｜时间 {saved_at}"
    )

