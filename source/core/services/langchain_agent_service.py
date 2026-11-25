from pathlib import Path

from langchain.agents import create_agent, middleware
from langchain.agents.middleware import SummarizationMiddleware
from langchain_community.document_loaders import TextLoader
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from core.services.langchain_agent_tools import code_runner
from core.services.langchain_agent_tools.db_controller import getbyid, addquestionbyid
from core.services.langchain_agent_tools.gettime import get_time
from core.services.langchain_agent_tools.wiki_search import wiki_search
from core.services.utils import langchain_llm_service

system_prompt = TextLoader(Path(__file__).resolve().parents[1] / "system_prompt.txt", encoding="utf-8").load()[0].page_content

llm = langchain_llm_service.get_llm()
tools = [code_runner.python_code, getbyid, addquestionbyid, get_time, wiki_search]
saver = InMemorySaver()
agent = create_agent(
    model = llm,
    checkpointer = saver,
    tools = tools,
    system_prompt=system_prompt,
    middleware=[
        SummarizationMiddleware(
            model=llm,
            trigger=("messages", 30),
            keep=("messages", 10),
        )
    ]
)


def agent_controller(id: int, question: str):
    config = {
        "configurable": {"thread_id": id}
    }
    input = {
        "messages": [HumanMessage(content=f"[student_id={id}] {question}")]

    }
    output = agent.invoke(input, config)["messages"][-1].content
    if not isinstance(output, str):
        output = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in output
        )
    return {"answer": output}
