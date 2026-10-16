"""PyYAML 的 libyaml C 实现统一入口（safe 语义，全仓共用）。

CSafeLoader/CSafeDumper 与纯 Python SafeLoader/SafeDumper 语义一致（不实例化
任意对象），大文档快约一个数量级（200KB 解析 ~2.1s→~0.27s）；环境未编译
libyaml 时自动回退纯 Python。使用处：clash（runtime.yaml 每请求解析）、
practice（Obsidian frontmatter 批量导入）、devtoolbox（JSON⇄YAML 端点）。
"""
try:
    from yaml import CSafeLoader as YamlLoader, CSafeDumper as YamlDumper
except ImportError:  # 未编译 libyaml 的环境
    from yaml import SafeLoader as YamlLoader, SafeDumper as YamlDumper

__all__ = ['YamlLoader', 'YamlDumper']
