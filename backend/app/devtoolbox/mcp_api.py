from typing import Literal

from pydantic import ConfigDict, Field

from app.shared.mcp_read import Input, read_provider, read_tool
from .routes import convert_text, hash_text


class TextInput(Input):
    text: str = Field(max_length=65536, description='原始文本，保留空格和换行。', examples=['hello'])

    # Whitespace is part of both the digest and the encoded byte stream.
    model_config = ConfigDict(str_strip_whitespace=False)


class HashInput(TextInput):
    algorithm: Literal['sha256', 'sha512', 'sha3_256', 'blake2b'] = Field(
        default='sha256', description='选择摘要算法。', examples=['sha256'])


class EncodingInput(TextInput):
    from_charset: str = Field(max_length=30, description='将原文编码回字节时使用的字符集。', examples=['latin-1'])
    to_charset: str = Field(max_length=30, description='用来解释字节的目标字符集。', examples=['utf-8'])


def compute_text_hash(args):
    """生成输入文本的 UTF-8 摘要，用于内容核对。"""
    return hash_text(args.text, args.algorithm)


def convert_text_encoding(args):
    """在受支持的字符集之间解释文本，可用于修复乱码。"""
    return convert_text(args.text, args.from_charset, args.to_charset)


mcp_provider = read_provider('开发者工具箱', 'devtoolbox', '执行文本摘要和字符集转换。', {
    'compute_text_hash': read_tool('计算文本摘要', '文本处理', HashInput, compute_text_hash),
    'convert_text_encoding': read_tool('转换文本编码', '文本处理', EncodingInput, convert_text_encoding),
})
