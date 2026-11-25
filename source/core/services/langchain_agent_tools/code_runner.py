import re

import requests

from core.services.utils.base64_change import decode_base64, encode_base64

JUDGE0_URL = "https://ce.judge0.com/submissions"
JUDGE0_LANGUAGE_ID = 71  # Python 3


_EXIT_CODE_PATTERN = re.compile(r"Exited with error status (\d+)")


def _exit_code(data: dict) -> int:
    """还原退出码：0 表示正常结束，非 0 表示运行出错。"""
    status_id = (data.get("status") or {}).get("id")
    if status_id == 3:  # Accepted
        return 0
    if status_id == 5:  # Time Limit Exceeded
        return 124
    matched = _EXIT_CODE_PATTERN.search(decode_base64(data.get("message")))
    if matched:
        return int(matched.group(1))
    return 1


def python_code(code: str, stdin: str = "") -> dict:
    """调用 Judge0 在线执行 Python 3 代码，返回运行结果。"""
    try:
        resp = requests.post(
            url=JUDGE0_URL,
            params={"base64_encoded": "true", "wait": "true"},
            json={
                "language_id": JUDGE0_LANGUAGE_ID,
                "source_code": encode_base64(code),
                "stdin": encode_base64(stdin),
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as exc:
        return {"error": f"代码执行服务调用失败：{exc}"}

    status = data.get("status") or {}
    if status.get("id") == 13:
        return {"error": f"代码执行服务内部错误：{status.get('description')}"}

    return {
        "run": {
            "stdout": decode_base64(data.get("stdout")),
            "stderr": decode_base64(data.get("stderr")),
            "code": _exit_code(data),
        },
        "compile": {"stderr": decode_base64(data.get("compile_output"))},
        "status": status.get("description"),
        "time": data.get("time"),
    }
