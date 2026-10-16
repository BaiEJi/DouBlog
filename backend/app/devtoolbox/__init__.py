"""开发者工具箱能力包：纯计算型工具的服务端（无表、无后台线程）。

前端 /devtoolbox 页约 30 个工具中，绝大多数在浏览器本地完成（隐私与零延迟）；
仅以下四类经本包提供——它们在浏览器中缺失或明显不如 Python 生态：

- 哈希：MD5 / SHA-3 / BLAKE 等（WebCrypto 只有 SHA-1/2），含 HMAC
- 字符集互转：mojibake 乱码修复（TextEncoder 仅支持 UTF-8，无法编码到 GBK/Big5）
- JSON ⇄ YAML：PyYAML（前端未引入 yaml 解析器）
- 二维码生成：segno（纯 Python，零依赖）

对外契约：仅 router——不需要 start_background / ensure_migrations。
"""
from .routes import router

__all__ = ['router']
