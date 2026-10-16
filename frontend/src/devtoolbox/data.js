/**
 * 静态数据集：HTTP 状态码 / MIME / ASCII 控制字符名 / 常用正则 / Cron 预设。
 * 只收录高频条目（速查用途，非完整注册表）。
 */

export const HTTP_CODES = [
  ...[100, 101, 102, 103].map(c => ({ c, t: { 100: '继续', 101: '切换协议', 102: '处理中', 103: '早期提示' }[c] })),
  ...[200, 201, 202, 204, 206, 207].map(c => ({ c, t: { 200: '成功', 201: '已创建', 202: '已接受', 204: '无内容', 206: '部分内容', 207: '多状态' }[c] })),
  ...[301, 302, 303, 304, 307, 308].map(c => ({ c, t: { 301: '永久重定向', 302: '临时重定向', 303: '参见其他', 304: '缓存未变', 307: '临时重定向（保方法）', 308: '永久重定向（保方法）' }[c] })),
  ...[400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 411, 412, 413, 415, 416, 418, 422, 425, 428, 429, 431, 451].map(c => ({
    c,
    t: { 400: '请求参数错误', 401: '未认证', 402: '需付款', 403: '无权限', 404: '资源不存在', 405: '方法不允许', 406: '不可接受', 408: '请求超时', 409: '冲突', 410: '已下线', 411: '需长度', 412: '前置条件失败', 413: '载荷过大', 415: '媒体类型不支持', 416: '范围不可满足', 418: '我是茶壶', 422: '语义错误', 425: '过早', 428: '需前置条件', 429: '请求过多（限流）', 431: '请求头过大', 451: '法律原因拒绝' }[c],
  })),
  ...[500, 501, 502, 503, 504, 505, 507, 508, 511].map(c => ({
    c,
    t: { 500: '服务器内部错误', 501: '未实现', 502: '网关错误', 503: '服务不可用', 504: '网关超时', 505: 'HTTP 版本不支持', 507: '存储不足', 508: '循环检测', 511: '需网络认证' }[c],
  })),
]

export const HTTP_CODE_GROUPS = [
  { label: '1xx 提示', test: c => c >= 100 && c < 200 },
  { label: '2xx 成功', test: c => c >= 200 && c < 300 },
  { label: '3xx 重定向', test: c => c >= 300 && c < 400 },
  { label: '4xx 客户端错误', test: c => c >= 400 && c < 500 },
  { label: '5xx 服务端错误', test: c => c >= 500 },
]

export const MIME_TYPES = [
  ['.html', 'text/html', '网页文档'],
  ['.htm', 'text/html', '网页文档'],
  ['.css', 'text/css', '样式表'],
  ['.js', 'text/javascript', '脚本'],
  ['.mjs', 'text/javascript', 'ES 模块脚本'],
  ['.json', 'application/json', 'JSON 数据'],
  ['.jsonl', 'application/x-ndjson', 'JSON Lines 流'],
  ['.xml', 'application/xml', 'XML 文档'],
  ['.yaml', 'text/yaml', 'YAML 配置'],
  ['.yml', 'text/yaml', 'YAML 配置'],
  ['.toml', 'application/toml', 'TOML 配置'],
  ['.csv', 'text/csv', '逗号分隔表格'],
  ['.txt', 'text/plain', '纯文本'],
  ['.md', 'text/markdown', 'Markdown 文档'],
  ['.pdf', 'application/pdf', 'PDF 文档'],
  ['.zip', 'application/zip', 'ZIP 压缩包'],
  ['.gz', 'application/gzip', 'GZIP 压缩'],
  ['.tar', 'application/x-tar', 'TAR 归档'],
  ['.png', 'image/png', '位图（无损）'],
  ['.jpg', 'image/jpeg', '照片（有损）'],
  ['.jpeg', 'image/jpeg', '照片（有损）'],
  ['.gif', 'image/gif', '动图'],
  ['.webp', 'image/webp', '新一代网页图'],
  ['.svg', 'image/svg+xml', '矢量图'],
  ['.avif', 'image/avif', 'AV1 图像'],
  ['.ico', 'image/x-icon', '站点图标'],
  ['.mp3', 'audio/mpeg', '音频'],
  ['.wav', 'audio/wav', '无损音频'],
  ['.flac', 'audio/flac', '无损音频'],
  ['.mp4', 'video/mp4', '视频'],
  ['.webm', 'video/webm', '网页视频'],
  ['.woff', 'font/woff', '网页字体'],
  ['.woff2', 'font/woff2', '网页字体（压缩）'],
  ['.ttf', 'font/ttf', 'TrueType 字体'],
  ['.otf', 'font/otf', 'OpenType 字体'],
  ['.wasm', 'application/wasm', 'WebAssembly'],
  ['.form-data', 'multipart/form-data', '表单文件上传'],
  ['.urlencoded', 'application/x-www-form-urlencoded', '表单默认编码'],
  ['.event-stream', 'text/event-stream', 'SSE 服务器推送流'],
  ['.ndjson', 'application/x-ndjson', 'JSON Lines'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel 工作簿'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word 文档'],
]

/** ASCII 控制字符名（0-31 + 127）；32-126 为可打印区 */
export const ASCII_CONTROL = {
  0: 'NUL 空', 1: 'SOH 标题开始', 2: 'STX 正文开始', 3: 'ETX 正文结束', 4: 'EOT 传输结束',
  5: 'ENQ 询问', 6: 'ACK 确认', 7: 'BEL 响铃', 8: 'BS 退格', 9: 'HT 水平制表',
  10: 'LF 换行', 11: 'VT 垂直制表', 12: 'FF 换页', 13: 'CR 回车', 14: 'SO 移出',
  15: 'SI 移入', 16: 'DLE 数据链转义', 17: 'DC1 设备控制1', 18: 'DC2 设备控制2', 19: 'DC3 设备控制3',
  20: 'DC4 设备控制4', 21: 'NAK 否认', 22: 'SYN 同步空闲', 23: 'ETB 传输块结束', 24: 'CAN 取消',
  25: 'EM 介质结束', 26: 'SUB 替换', 27: 'ESC 转义', 28: 'FS 文件分隔', 29: 'GS 组分隔',
  30: 'RS 记录分隔', 31: 'US 单元分隔', 127: 'DEL 删除',
}

export const COMMON_REGEXES = [
  { name: '邮箱', value: String.raw`^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$` },
  { name: 'URL', value: String.raw`^https?://[^\s/$.?#].[^\s]*$` },
  { name: 'IPv4 地址', value: String.raw`^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$` },
  { name: '手机号（大陆）', value: String.raw`^1[3-9]\d{9}$` },
  { name: '身份证（18 位）', value: String.raw`^\d{6}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$` },
  { name: '日期 YYYY-MM-DD', value: String.raw`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$` },
  { name: '十六进制颜色', value: String.raw`^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$` },
  { name: '中文字符', value: String.raw`[\u4e00-\u9fa5]` },
  { name: '非零正整数', value: String.raw`^[1-9]\d*$` },
  { name: '科学计数法数字', value: String.raw`^-?\d+(\.\d+)?[eE][+-]?\d+$` },
  { name: '空白行', value: String.raw`^\s*$` },
  { name: 'HTML 标签', value: String.raw`</?[a-zA-Z][^>]*>` },
  { name: 'JWT', value: String.raw`^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$` },
  { name: 'MD5 哈希', value: String.raw`^[a-fA-F0-9]{32}$` },
  { name: 'UUID', value: String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` },
]

export const CRON_PRESETS = [
  { name: '每分钟', value: '* * * * *' },
  { name: '每 5 分钟', value: '*/5 * * * *' },
  { name: '每 15 分钟', value: '*/15 * * * *' },
  { name: '每半小时', value: '*/30 * * * *' },
  { name: '每小时（第 0 分）', value: '0 * * * *' },
  { name: '每 2 小时', value: '0 */2 * * *' },
  { name: '每天 00:00', value: '0 0 * * *' },
  { name: '每天 08:30', value: '30 8 * * *' },
  { name: '工作日 09:00', value: '0 9 * * 1-5' },
  { name: '每周一 10:00', value: '0 10 * * 1' },
  { name: '每月 1 号 00:00', value: '0 0 1 * *' },
  { name: '每季度首日', value: '0 0 1 1,4,7,10 *' },
  { name: '每年 1 月 1 日', value: '0 0 1 1 *' },
  { name: '工作日下班 18:30', value: '30 18 * * 1-5' },
  { name: '周末 12:00', value: '0 12 * * 0,6' },
]

/** 单位换算表：各类别的基准单位与换算因子（到基准的倍数） */
export const UNIT_TABLES = {
  length: { label: '长度', base: 'm', units: {
    mm: ['毫米', 0.001], cm: ['厘米', 0.01], m: ['米', 1], km: ['千米', 1000],
    in: ['英寸 in', 0.0254], ft: ['英尺 ft', 0.3048], yd: ['码 yd', 0.9144], mi: ['英里 mi', 1609.344], nmi: ['海里 nmi', 1852],
  } },
  mass: { label: '重量', base: 'kg', units: {
    mg: ['毫克', 1e-6], g: ['克', 0.001], kg: ['千克', 1], t: ['吨', 1000],
    oz: ['盎司 oz', 0.028349523125], lb: ['磅 lb', 0.45359237], jin: ['斤', 0.5],
  } },
  data: { label: '数据量（十进制）', base: 'B', units: {
    B: ['字节 B', 1], KB: ['千字节 KB (10³)', 1e3], MB: ['兆字节 MB (10⁶)', 1e6], GB: ['吉字节 GB (10⁹)', 1e9], TB: ['太字节 TB (10¹²)', 1e12],
    KiB: ['千字节 KiB (2¹⁰)', 1024], MiB: ['兆字节 MiB (2²⁰)', 1024 ** 2], GiB: ['吉字节 GiB (2³⁰)', 1024 ** 3], TiB: ['太字节 TiB (2⁴⁰)', 1024 ** 4],
    bit: ['比特 bit', 0.125],
  } },
  speed: { label: '速度', base: 'm/s', units: {
    'm/s': ['米/秒', 1], 'km/h': ['千米/时', 1 / 3.6], mph: ['英里/时 mph', 0.44704], kn: ['节 kn', 0.514444], mach: ['马赫 (340 m/s)', 340],
  } },
  area: { label: '面积', base: 'm2', units: {
    'm2': ['平方米', 1], 'km2': ['平方千米', 1e6], ha: ['公顷 ha', 1e4], mu: ['亩', 666.6667], 'ft2': ['平方英尺', 0.09290304], acre: ['英亩', 4046.8564224],
  } },
  time: { label: '时间', base: 's', units: {
    ms: ['毫秒', 0.001], s: ['秒', 1], min: ['分钟', 60], h: ['小时', 3600], d: ['天', 86400], wk: ['周', 604800], yr: ['年 (365d)', 31536000],
  } },
}

/** 温度换算独立处理（非线性）：统一先转开尔文 */
export const TEMP_TABLE = {
  label: '温度', units: {
    '°C': ['摄氏度', v => v + 273.15, k => k - 273.15],
    '°F': ['华氏度', v => (v + 459.67) * 5 / 9, k => k * 9 / 5 - 459.67],
    K: ['开尔文', v => v, k => k],
  },
}
