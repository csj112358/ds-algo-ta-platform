from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from core.services.utils.langchain_llm_service import get_llm
from core.services.utils.prompt import CHAT_PROMPT

llm = get_llm()

prompt = ChatPromptTemplate.from_template(CHAT_PROMPT)

chain = prompt | llm | StrOutputParser()


def chat(question: str):
    return {"answer": chain.invoke({"question": question})}
