import os
from pathlib import Path

from crewai import LLM
from dotenv import load_dotenv

def get_llm():
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
    llm = LLM(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_BASE_URL"),
        model=os.getenv("MODEL_NAME"),
        custom_openai=True,
        temperature=0.7,
        timeout=120,
    )
    return llm