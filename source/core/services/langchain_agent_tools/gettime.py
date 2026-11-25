import datetime


def get_time():
    """获取当前时间，格式：YYYY-MM-DD HH:MM:SS（可直接用作入库的 created_at）"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
