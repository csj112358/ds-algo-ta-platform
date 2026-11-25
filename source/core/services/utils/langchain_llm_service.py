import os
from pathlib import Path
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

def get_llm():
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
    llm = ChatOpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_BASE_URL"),
        model=os.getenv("MODEL_NAME"),
    )
    return llm