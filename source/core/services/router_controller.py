"""意图分流 service：只负责判断「学生这句话该由谁回答」，不碰 HTTP。

HTTP 入口和四路分发在 services/views.py 的 route() 里，这里只对外暴露 classify_intent()。
classify_intent() 把模型输出的标签直接拿去查 ROUTE_PATHS，返回该调的接口路径。
"""

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from core.services.utils.langchain_llm_service import get_llm
from core.services.utils.prompt import ROUTER_PROMPT

llm = get_llm()
prompt = ChatPromptTemplate.from_template(ROUTER_PROMPT)
chain = prompt | llm | StrOutputParser()

ROUTE_PATHS = {
    "report": "/api/report/",   # 生成学习报告
    "tool": "/api/agent/",    # 跑代码 / 查记录 / 问时间 / 查百科
    "rag": "/api/rag/",       # 查课程知识库
    "chat": "/api/chat/",     # 闲聊
}


def classify_intent(question: str):
    label = chain.invoke({"question": question}).split()[0].strip("。，、,.:：;；`'\"*").lower()
    return {"label": label, "path": ROUTE_PATHS[label]}
