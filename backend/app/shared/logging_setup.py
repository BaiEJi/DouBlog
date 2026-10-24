"""DouBlog 日志接入 lizysdk（自摄 WARNING+ 回灌 /api/v1/logs，防回环三闸）。"""

import logging
import os

from app.config import settings


def setup_logging_for_app():
    """DouBlog 日志接入 lizysdk：落盘 data/logs/doublog.log（INFO+，轮转），
    WARNING+ 回灌自身 /api/v1/logs（在 /logs 页可检索，含异常堆栈）。

    防回环：摄入端点自身的错误带 no_remote 标记只落盘不外发——否则
    「摄入 500 → 记错误 → 又发给自己 → 再 500」会自我放大。
    """
    from app.shared.modules import load_logs_config
    from lizysdk.logs import setup_logging
    from lizysdk.logs.context import peek_context
    from lizysdk.logs.handlers import _SendHandler
    cfg = load_logs_config()
    setup_logging(
        os.path.join(settings.data_dir, 'logs'), 'doublog.log',
        level='INFO', console=True, rotation='size',
        max_bytes=10 * 1024 * 1024, backup_count=5,
        sys_name='doublog',
        send_json=cfg['enabled'],
        send_url=cfg['url'],
        send_timeout=1.5,
    )

    # 全局注入：LogRecord 工厂在**记录创建线程**运行（标准 Logger/SDK PipeLogger
    # 的 makeRecord 都走它），把 lizysdk context（trace_id 等）快照进 bk_fields。
    # 不能用 handler filter——SDK 的 _PipeQueueHandler 覆写 handle() 绕过 filters；
    # 不能用 root logger filter——不随 propagate 作用于子 logger 的记录。
    _orig_factory = logging.getLogRecordFactory()

    def _factory_with_context(*args, **kwargs):
        record = _orig_factory(*args, **kwargs)
        ctx = peek_context()
        if ctx:
            existing = getattr(record, 'bk_fields', None)
            if existing:
                for k, v in ctx.items():
                    existing.setdefault(k, v)
            else:
                record.bk_fields = dict(ctx)
        return record

    # Config saves may reinstall handlers repeatedly; do not build an ever
    # growing recursive chain of factories on every save.
    if not getattr(_orig_factory, '_doublog_context_factory', False):
        _factory_with_context._doublog_context_factory = True
        logging.setLogRecordFactory(_factory_with_context)

    class _SendGate(logging.Filter):
        """发送端唯一闸门：只放行 WARNING+ 且未标记 no_remote 的记录。

        必须在过滤器里做级别判断——发送 handler 在 SDK 的 QueueListener 消费端，
        标准库默认 respect_handler_level=False，handler.setLevel 会被无视。
        """

        def filter(self, record):
            if record.levelno < getattr(_SendGate, 'min_level', logging.WARNING):
                return False
            return not record.__dict__.get('no_remote')

    # async_writer=True 时 _SendHandler 不在 root.handlers 上，而在消费端
    # （_BACKEND.listener.handlers）；两种位置都找一遍
    from lizysdk.logs import handlers as _lh
    send = None
    be = getattr(_lh, '_BACKEND', None)
    if be is not None and getattr(be, 'listener', None) is not None:
        send = next((h for h in be.listener.handlers if isinstance(h, _SendHandler)), None)
    if send is None:
        send = next((h for h in logging.getLogger().handlers if isinstance(h, _SendHandler)), None)
    _SendGate.min_level = logging.INFO if cfg['level'] == 'INFO' else logging.WARNING
    if send is not None:
        send.addFilter(_SendGate())      # WARNING+ 且非 no_remote 才外发
