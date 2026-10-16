/**
 * 工具注册表：分组、名称、描述、组件——侧栏导航、首页索引与搜索共用此单源。
 * 组件接收 { toast }（需要轻提示的工具用；纯本地工具不依赖）。
 */
import { lazy } from 'react'

const tool = (id, name, desc, loader) => ({ id, name, desc, Component: lazy(loader) })

export const GROUPS = [
  {
    id: 'json', name: 'JSON', tools: [
      tool('json-format', 'JSON 格式化', '格式化 / 压缩 / 校验 / 键排序', () => import('./tools/JsonFormatTool')),
      tool('json-diff', 'JSON Diff', '深度对比，按路径列出增删改', () => import('./tools/JsonDiffTool')),
      tool('json-yaml', 'JSON ⇄ YAML', '双向转换（后端 PyYAML）', () => import('./tools/JsonYamlTool')),
      tool('json-csv', 'JSON ⇄ CSV', '表格互转，RFC 4180 引号规则', () => import('./tools/JsonCsvTool')),
      tool('json-to-code', 'JSON 转代码', 'TypeScript / Go / Python 类型', () => import('./tools/JsonToCodeTool')),
      tool('json-escape', 'JSON 转义', '字符串 ⇄ \\u 转义形式', () => import('./tools/JsonEscapeTool')),
    ],
  },
  {
    id: 'text', name: '文本', tools: [
      tool('text-diff', '文本对比', '行级 diff + 行内高亮，并排/统一', () => import('./tools/TextDiffTool')),
      tool('text-stats', '文本统计', '字数 / CJK / 词频 / 字节', () => import('./tools/TextStatsTool')),
      tool('case-convert', '命名转换', 'camelCase / snake / kebab 等 13 种', () => import('./tools/CaseConvertTool')),
      tool('text-lines', '文本行处理', '去重 / 排序 / 去空行 / 编号', () => import('./tools/TextLinesTool')),
      tool('lorem', '占位文本', '中文 / 英文 Lorem 随机生成', () => import('./tools/LoremTool')),
    ],
  },
  {
    id: 'encoding', name: '编码', tools: [
      tool('base64', 'Base64', '编解码 + 文件转 data URL', () => import('./tools/Base64Tool')),
      tool('url-codec', 'URL 编解码', 'encodeURIComponent / encodeURI', () => import('./tools/UrlCodecTool')),
      tool('html-entity', 'HTML 实体', '命名实体 + 数字实体编解码', () => import('./tools/HtmlEntityTool')),
      tool('unicode', 'Unicode 转换', '\\uXXXX 转义 + 码点明细表', () => import('./tools/UnicodeTool')),
      tool('charset', '字符集互转', 'GBK / Big5 乱码修复（后端）', () => import('./tools/CharsetTool')),
    ],
  },
  {
    id: 'crypto', name: '加密哈希', tools: [
      tool('hash', '哈希计算', 'MD5 / SHA / SHA-3 / BLAKE / HMAC', () => import('./tools/HashTool')),
      tool('jwt', 'JWT 解码', 'header / payload / 有效期', () => import('./tools/JwtTool')),
      tool('password', '密码生成器', '随机密码 + 口令短语 + 熵估计', () => import('./tools/PasswordTool')),
    ],
  },
  {
    id: 'time', name: '时间', tools: [
      tool('timestamp', '时间戳转换', 'Unix ⇄ 日期 / 当前时间 / 时间差', () => import('./tools/TimestampTool')),
      tool('cron', 'Cron 表达式', '解析 + 中文解释 + 未来运行', () => import('./tools/CronTool')),
    ],
  },
  {
    id: 'generate', name: '转换生成', tools: [
      tool('uuid', 'UUID / 短 ID', 'v4 / v7 / NanoID 批量生成', () => import('./tools/UuidTool')),
      tool('radix', '进制转换', '2-36 进制互转 + 字节视图', () => import('./tools/RadixTool')),
      tool('units', '单位换算', '长度 / 重量 / 数据量 / 温度等', () => import('./tools/UnitsTool')),
      tool('color', '颜色转换', 'HEX / RGB / HSL + WCAG 对比度', () => import('./tools/ColorTool')),
      tool('qrcode', '二维码生成', 'SVG + PNG（后端 segno）', () => import('./tools/QrTool')),
    ],
  },
  {
    id: 'web', name: '网络', tools: [
      tool('url-parse', 'URL 解析', '组成部分拆解 + 参数表格', () => import('./tools/UrlParseTool')),
      tool('subnet', 'IPv4 子网计算', 'CIDR → 掩码 / 主机范围', () => import('./tools/SubnetTool')),
    ],
  },
  {
    id: 'dev', name: '开发', tools: [
      tool('regex', '正则测试', '实时高亮 + 分组捕获 + 模板库', () => import('./tools/RegexTool')),
      tool('md-preview', 'Markdown 预览', '博客同款渲染管线', () => import('./tools/MarkdownTool')),
      tool('cheatsheet', '速查表', 'HTTP 状态码 / MIME / ASCII', () => import('./tools/CheatSheetTool')),
    ],
  },
]

export const ALL_TOOLS = GROUPS.flatMap(g => g.tools.map(t => ({ ...t, group: g.id, groupName: g.name })))

export const findTool = id => ALL_TOOLS.find(t => t.id === id) || null
