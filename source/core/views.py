from pathlib import Path

from django.http import HttpResponse
from django.http.response import JsonResponse
from django.shortcuts import render

from core.services import langchain_chat_service
from core.services import students_service
from core.services.crew_service import generate_learning_report
from core.services.langchain_agent_service import agent_controller
from core.services.langchain_rag_service import ask
from core.services.router_controller import classify_intent

FRONT_DIR = Path(__file__).resolve().parents[2] / "front"

JSON_DUMPS_PARAMS = {"ensure_ascii": False}


def home(request):
    return HttpResponse(
        (FRONT_DIR / "index.html").read_text(encoding="utf-8"),
        content_type="text/html; charset=utf-8",
    )


def health(request):
    return JsonResponse({"ok": True, "service": "数据结构与算法助教平台"})


# Create your views here.
def crew(request):
    student_id = request.POST.get("student_id")
    result = generate_learning_report(student_id)
    return JsonResponse(
        result["body"],
        status=result["status"],
        json_dumps_params=JSON_DUMPS_PARAMS,
    )

def agent(request):
    student_id = request.POST.get("student_id")
    question = request.POST.get("question")
    return JsonResponse(
        agent_controller(student_id, question),
        json_dumps_params=JSON_DUMPS_PARAMS,
    )

def chat(request):
    question = request.POST.get("question")
    return JsonResponse(
        langchain_chat_service.chat(question),
        json_dumps_params=JSON_DUMPS_PARAMS,
    )

def rag(request):
    question = request.POST.get("question")
    return JsonResponse(ask(question), json_dumps_params=JSON_DUMPS_PARAMS)

def router(request):
    question = request.POST.get("question")
    return JsonResponse(
        classify_intent(question),
        json_dumps_params=JSON_DUMPS_PARAMS,
    )

def students(request):
    if request.method == "POST":
        name = (request.POST.get("name") or "").strip()
        if not name:
            return JsonResponse(
                {"error": "学生姓名不能为空"},
                status=400,
                json_dumps_params=JSON_DUMPS_PARAMS,
            )
        student = students_service.add_student(name)
        return JsonResponse(
            {"student": student, "students": students_service.list_students()},
            json_dumps_params=JSON_DUMPS_PARAMS,
        )
    return JsonResponse(
        {"students": students_service.list_students()},
        json_dumps_params=JSON_DUMPS_PARAMS,
    )
