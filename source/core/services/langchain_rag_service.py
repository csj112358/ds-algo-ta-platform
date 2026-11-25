from pathlib import Path

from langchain_core.documents import Document
from django.conf import settings
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_text_splitters import RecursiveCharacterTextSplitter
from core.services.utils.langchain_llm_service import get_llm
from core.services.utils.pdf_viewer import extract_text_from_pdf

llm = get_llm()

CORE_DIR = Path(__file__).resolve().parents[1]
KNOWLEDGE_PDF = CORE_DIR / "knowledge" / "数据结构与算法知识库文档.pdf"
# 嵌入模型：优先用本地目录 source/bge-small-zh-v1.5（离线可用）；
# 本地没有就传 HuggingFace 模型名，首次运行自动下载（国内可设 HF_ENDPOINT=https://hf-mirror.com）。
_LOCAL_EMBEDDING_MODEL = Path(settings.BASE_DIR) / "bge-small-zh-v1.5"
EMBEDDING_MODEL = str(_LOCAL_EMBEDDING_MODEL) if _LOCAL_EMBEDDING_MODEL.exists() else "BAAI/bge-small-zh-v1.5"

text = extract_text_from_pdf(str(KNOWLEDGE_PDF))
chunks = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100).split_text(text)
docs = [
    Document(page_content=c, metadata={"source": KNOWLEDGE_PDF.name, "chunk_id": i})
    for i, c in enumerate(chunks)# (0, chunks[0]), (1, chunks[1]), (2, chunks[2]), ...
]
embeddings = HuggingFaceEmbeddings(# 加载模型
    model_name=EMBEDDING_MODEL,
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True},
)
collection = Chroma.from_texts(
    [d.page_content for d in docs],# 文本内容
    embeddings,# 嵌入模型
    metadatas=[d.metadata for d in docs]# 从 docs 里抽出元数据列表
)
retriever = collection.as_retriever(search_kwargs={"k": 4})

def get_docs(question: str) -> str:
    docs = retriever.invoke(question)
    if not docs:
        return "没有找到相关文档"
    return "\n\n".join(d.page_content for d in docs)

prompt = ChatPromptTemplate.from_template("你是一个《数据结构与算法》课程知识库问答助手。系统已经读取了数组、链表、栈、队列等课程文档，并将文档切分成小段、做 Embedding 后存入向量库。现在系统根据检索出若干知识片段{context}，作为你回答{question}的唯一可信依据。")

rag_chain = (
    {"context": get_docs,
     "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)

def ask(question: str):
    answer = rag_chain.invoke(question)
    return {
        "answer": answer,
        "sources": [
            {
                "file": d.metadata.get("source", "未知"),
                "chunk_id": d.metadata.get("chunk_id"),
                "snippet": d.page_content,
            }
            for d in retriever.invoke(question)
        ],
    }
