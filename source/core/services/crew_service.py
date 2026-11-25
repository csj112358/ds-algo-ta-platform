import datetime
import sqlite3
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path

from crewai import Agent, Task, CheckpointConfig, Crew, Process
from crewai.state import SqliteProvider
from crewai.tools import tool
from crewai.tools.base_tool import Tool
from crewai.types.callback import callable_to_string
from pydantic import field_serializer

from core.services.utils import crew_llm_service
BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "database" / "course.db"

CREW_TIMEOUT_SECONDS = 120
_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="crew")


class SerializableTool(Tool):
    @field_serializer("func", when_used="json")
    def _serialize_func(self, f):
        return callable_to_string(f)

    @classmethod
    def from_tool(cls, t: Tool) -> "SerializableTool":
        return cls(**t.model_dump())


@tool("get_current_time")
def get_time():
    """获取当前时间，格式：YYYY-MM-DD HH:MM:SS"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


get_time = SerializableTool.from_tool(get_time)

#本周：做题数 / 平均掌握度 / 通过率
#累计做题总数
#累计平均掌握度
#掌握度合计
#累计通过率
#薄弱题
#各知识点平均掌握度
def summarize_records(student_id: int) -> dict:
    connect = sqlite3.connect(str(DB_PATH))
    connect.row_factory = sqlite3.Row
    rows = connect.execute(
        "select * from questions where student_id = ? order by id", (student_id,)
    ).fetchall()
    valid = [r for r in rows if (r["knowledge_points"] or "").strip().lower() != "probe"]
    mastery = [r["mastery"] for r in valid if isinstance(r["mastery"], int)]
    total = len(valid)  # 累计做题总数
    avg_mastery = round(sum(mastery) / len(mastery), 2) if mastery else 0  # 累计平均掌握度
    passed = len([m for m in mastery if m >= 60])  # 累计通过率的分子（>= 60 记为通过）
    pass_rate = round(passed / len(mastery) * 100, 1) if mastery else 0  # 累计通过率（百分比）
    # 本周：做题数 / 平均掌握度 / 通过率（复用已经过滤好的 valid，不新增 SQL）
    week_start = (datetime.date.today()
                  - datetime.timedelta(days=datetime.date.today().weekday())).isoformat()
    week = [r for r in valid if (r["created_at"] or "")[:10] >= week_start]  # 本周做题数 = len(week)
    week_m = [r["mastery"] for r in week if isinstance(r["mastery"], int)]
    week_avg = round(sum(week_m) / len(week_m), 2) if week_m else 0  # 本周平均掌握度
    week_pass = round(len([m for m in week_m if m >= 60]) / len(week_m) * 100, 1) if week_m else 0  # 本周通过率
    # 薄弱题：掌握度低于 60，按最低分取前 5 条
    weak = connect.execute(
        "select question, min(mastery) as m from questions "
        "where student_id = ? and mastery is not null and mastery < 60 "
        "group by question order by m asc limit 5",
        (student_id,),
    ).fetchall()
    # 各知识点平均掌握度：按 knowledge_points 分组，按平均分从低到高
    by_point = connect.execute(
        "select knowledge_points as kp, round(avg(mastery), 1) as avg_m, count(*) as c "
        "from questions where student_id = ? and coalesce(trim(knowledge_points), '') <> '' "
        "group by knowledge_points order by avg_m asc",
        (student_id,),
    ).fetchall()
    connect.close()

    lines = ["[本题会话的做题记录（原始行，字段顺序：id, question, answer, mastery, knowledge_points, student_id, created_at）]"]
    if rows:
        lines += [str(tuple(r)) for r in rows]
    else:
        lines.append("（该学号没有任何做题记录）")
    lines.append("")
    lines.append("[系统用 SQL 算好的统计数字——这些是唯一权威数字，直接引用，禁止重新计算或改动]")
    # 本周：做题数 / 平均掌握度 / 通过率
    lines.append(f"- 【本周 · {week_start} 起】做题数：{len(week)} 题 / 平均掌握度 {week_avg} / 通过率（正确率）{week_pass}%")
    # 累计做题总数
    lines.append(f"- 累计做题总数（全部历史，不可当作本周）：{total} 题（该学号查询到 {len(rows)} 行原始记录）")
    # 累计平均掌握度
    lines.append(f"- 累计平均掌握度：{avg_mastery}")
    # 掌握度合计（= mastery 全部求和）
    lines.append(f"- 掌握度合计：{sum(mastery)}")
    # 累计通过率（正确率）
    lines.append(
        f"- 累计通过率（正确率）：{pass_rate}%（{passed} / {total}，口径为掌握度 >= 60 视为通过）"
    )
    # 薄弱题
    lines.append(f"- 薄弱题（掌握度低于 60，最多 5 条）：{[(r['question'], r['m']) for r in weak] or '无'}")
    # 各知识点平均掌握度（低到高）
    lines.append("- 各知识点平均掌握度（低到高）：" + ("；".join(
        f"{r['kp']} 平均 {r['avg_m']}（{r['c']} 题）" for r in by_point) or "无"))
    return {
        "records": rows,
        "text": "\n".join(lines),
        "total": total,
        "avg_mastery": avg_mastery,
        "pass_rate": pass_rate,
    }


def generate_learning_report(student_id: int):
    student_data = summarize_records(student_id)["text"]

    llm = crew_llm_service.get_llm()
    researcher_agent = Agent(
        role="研究员", # 功能和专长
        goal="整理学习数据",# 目标
        backstory="擅长分析学习情况",# 背景
        allow_delegation=False,# 不允许委托
        llm=llm,# 模型
        verbose=True,# 是否打印中间过程
        tools=[get_time],# 工具
    )
    writer_agent = Agent(
        role="写手",
        goal="写报告",
        backstory="擅长写技术学习报告",
        allow_delegation=False,
        llm=llm,
        verbose=True,
        tools=[get_time],
    )

    researcher_task = Task(
        description=(
            f"下面是学号 {student_id} 学生的真实做题记录，字段顺序是 "
            "(id, question, answer, mastery, knowledge_points, student_id, created_at)，"
            "mastery 是 0-100 的掌握度，越低越薄弱：\n"
            f"{student_data}\n\n"
            "注意：其中带「系统用 SQL 算好的统计数字」的那一段是系统已经算准的权威数字。"
            "这些数字必须原样引用，禁止自己重新数记录条数、禁止自己做加法或除法去改平均值，"
            "禁止猜测缺失的行。\n\n"
            "先调用 get_current_time 拿到当前时间，再整理数据要点：本周做题数（必须原样引用【本周】那一行）、"
            "累计做题总数、平均掌握度、通过率、"
            "各知识点掌握情况、薄弱点（掌握度低的题和知识点）、值得表扬的地方。"
            "只能基于上面这些真实数据，禁止编造，只输出要点列表。"
        ),
        expected_output="根据学生真实做题记录、错题、掌握度整理要点",
        agent=researcher_agent,
    )
    write_task = Task(
        description=(
            f"根据研究员的要点，写一份学号 {student_id} 学生的 Markdown 报告。"
            "报告里的每一个数字都必须直接照抄研究员要点中的数字，"
            "禁止自己重新统计条数、重新计算平均值或正确率。"
            "报告开头第一段先写统计区间（照抄【本周 · 日期 起】里的日期）；"
            "凡出现「本周」只能引用【本周】那一行的数字，累计数字必须写成「累计」，不能写成「本周」。"
        ),
        expected_output="写一份 Markdown 学习报告。报告必须包含真实数据，不能编造。例如学生点“生成本周学习报告”，报告里要有本周做题数、正确率、各知识点掌握度、薄弱点、下周建议。其中正确率直接引用「通过率（正确率）」那一行",
        agent=writer_agent,
        context=[researcher_task],
    )

    checkpoint_config = CheckpointConfig(
        location=str(Path(__file__).resolve().parents[1] / "database" / "crew_checkpoints.db"),
        provider=SqliteProvider(),
        on_events=["task_completed"],
        max_checkpoints=20,
    )

    crew = Crew(
        tasks=[researcher_task, write_task],
        agents=[researcher_agent, writer_agent],
        checkpoint=checkpoint_config,
        process=Process.sequential,
        verbose=True,
    )
    try:
        report = _EXECUTOR.submit(crew.kickoff).result(timeout=CREW_TIMEOUT_SECONDS).raw
    except FutureTimeout:
        return {
            "status": 504,
            "body": {
                "student_id": student_id,
                "error": f"报告生成超时（超过 {CREW_TIMEOUT_SECONDS} 秒），请稍后重试",
            },
        }
    return {"status": 200, "body": {"student_id": student_id, "report": report}}
