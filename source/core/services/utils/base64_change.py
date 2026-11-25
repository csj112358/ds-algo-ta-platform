import base64


def encode_base64(text: str) -> str:
    """把文本编码成只含 ASCII 的 base64 字符串（Judge0 用它传输中文）。"""
    return base64.b64encode(text.encode("utf-8")).decode("ascii")

def decode_base64(text: str | None) -> str:
    """把 Judge0 返回的 base64 字符串还原成文本。"""
    if not text:
        return ""
    return base64.b64decode(text).decode("utf-8", errors="replace")