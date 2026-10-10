"""消息推送发送端:各渠道共享统一入口,目前实现邮件(smtp),其余渠道预留。

未来接入新渠道(apk/chrome/chatbot/other)时,在 dispatch() 注册对应的发送函数即可,
配置统一存放在 settings.notifications.channels.<channel>,上层无需感知渠道差异。
"""
from __future__ import annotations

import smtplib
from email.header import Header
from email.mime.text import MIMEText
from typing import Any

# 各渠道展示名(配置页与错误信息共用)
CHANNEL_LABELS: dict[str, str] = {
    "email": "邮件推送",
    "apk": "APK 推送",
    "chrome": "Chrome 浏览器推送",
    "chatbot": "Chatbot 推送",
    "other": "其他类型",
}

# 已接入发送端的渠道
IMPLEMENTED_CHANNELS = {"email"}


def send_email(cfg: dict[str, Any], subject: str, body: str) -> None:
    """通过 SMTP 发送邮件。配置不完整或服务器拒绝时抛异常,由调用方转为 HTTP 错误。

    smtp_ssl=True 走 SMTPS(通常 465);False 走 STARTTLS(通常 587)。
    """
    host = str(cfg.get("smtp_host") or "").strip()
    port = int(cfg.get("smtp_port") or 465)
    use_ssl = bool(cfg.get("smtp_ssl", True))
    username = str(cfg.get("username") or "")
    password = str(cfg.get("password") or "")
    sender = str(cfg.get("sender") or username)
    recipient = str(cfg.get("recipient") or "")

    if not host:
        raise ValueError("SMTP 服务器不能为空")
    if not username or not password:
        raise ValueError("SMTP 登录账号或授权密钥不能为空")
    if not recipient:
        raise ValueError("收件人邮箱不能为空")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = sender
    msg["To"] = recipient

    server: smtplib.SMTP | smtplib.SMTP_SSL
    if use_ssl:
        server = smtplib.SMTP_SSL(host, port, timeout=10)
    else:
        server = smtplib.SMTP(host, port, timeout=10)
        server.starttls()
    try:
        server.login(username, password)
        server.sendmail(sender, [recipient], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


def dispatch(channel: str, cfg: dict[str, Any], title: str, body: str) -> None:
    """共享发送入口:按渠道分发。未接入的渠道抛 NotImplementedError。"""
    if channel == "email":
        send_email(cfg, title, body)
        return
    raise NotImplementedError(f"渠道 {CHANNEL_LABELS.get(channel, channel)} 的发送端尚未接入(预留)")
