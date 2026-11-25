"""core 应用的接口路由：路径 → views 里的视图函数。"""

from django.urls import path
from . import views


urlpatterns = [
    path("", views.home),
    path("api/health/", views.health),
    path("api/report/", views.crew),
    path("api/agent/", views.agent),
    path("api/chat/", views.chat),
    path("api/rag/", views.rag),
    path("api/router/", views.router),
    path("api/students/", views.students),

]
