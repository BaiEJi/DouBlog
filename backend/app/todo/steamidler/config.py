"""steamidler 子模块配置(源 config.py 适配 docs/steamidler-migration.md)。

变更:目录推导与独立 DB 文件路径已删除(存储并入 Doublog 主库,模块内无任何
落盘路径);Steam API 常量/轮询/重连/EResult 文案逐行照搬。
"""
import sys


# 同时挂机游戏数上限(与官方客户端一致)
MAX_IDLE_GAMES = 32

# 设备名称(登录时展示在 Steam 令牌确认里)
DEVICE_NAME = "steam-idler"

# 登录轮询
POLL_INTERVAL = 5.0          # 秒,PollAuthSessionStatus 轮询间隔
POLL_TIMEOUT = 300.0         # 秒,登录尝试超时

# CM 重连退避
RECONNECT_MIN_DELAY = 5.0
RECONNECT_MAX_DELAY = 120.0

HOST_OS = "linux" if sys.platform.startswith("linux") else ("macos" if sys.platform == "darwin" else "windows")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# k_EAuthSessionGuardType
GUARD_EMAIL_CODE = 2
GUARD_DEVICE_CODE = 3
GUARD_DEVICE_CONFIRMATION = 4
GUARD_EMAIL_CONFIRMATION = 5
GUARD_MACHINE_TOKEN = 6

GUARD_NAMES = {
    2: "邮箱验证码",
    3: "令牌验证码",
    4: "手机 App 确认",
    5: "邮箱链接确认",
    6: "受信任设备",
}

ERESULT_TEXT = {
    1: "成功",
    2: "失败",
    5: "账号或密码错误",
    11: "服务器繁忙,请稍后再试",
    12: "验证码错误",
    13: "验证码已被使用",
    15: "访问被拒绝",
    16: "目标服务器繁忙",
    17: "服务器过载",
    18: "账号被限制",
    29: "登录会话已过期,请重新发起登录",
    65: "令牌验证码错误",
    84: "请求过于频繁,请稍后再试",
    86: "登录尝试次数过多已被限流,请稍后再试",
    87: "账号已被临时锁定,请稍后再试",
}


def eresult_text(code):
    return ERESULT_TEXT.get(code, f"未知错误 (EResult={code})")
