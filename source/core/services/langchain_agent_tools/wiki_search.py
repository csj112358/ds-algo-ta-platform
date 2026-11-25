import os
from pathlib import Path
import requests
from dotenv import load_dotenv


def wiki_search(search_question: str) -> dict:
    """调用 Wikipedia API 搜索"""
    url = f"https://appbuilder.baidu.com/v2/baike/lemma/get_content"
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
    headers = {
        "Authorization": os.getenv("BAIDU_WIKI_API_KEY"),
    }
    params = {
        "search_type": "lemmaTitle",
        "search_key": search_question,
    }
    try:

        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        return response.json()["result"]
    except requests.RequestException as e:
        return {"error": str(e)}
