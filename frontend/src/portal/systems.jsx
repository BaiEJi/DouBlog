/**
 * 门户卡片定义单源：key（模块标识，持久化用）/ to（路由）/ 默认标题与描述 /
 * 配色 box / 图标。布局与标题描述覆盖持久化在服务端（system_home_cards 表，
 * key 为卡片唯一标识），此处只保留内置默认——服务端无该卡记录或覆盖为空时
 * 展示本表文案，新增模块自动追加到门户末组。
 */
export const SYSTEMS = [
  {
    key: 'mindmap',
    to: '/mindmap',
    title: '思维导图',
    desc: '知识结构 · 自由编辑 · 自动保存 · 版本恢复',
    box: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <rect x="1.8" y="7.3" width="5.8" height="5.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.6 10h3.2m0 0V4.5h2.4m-2.4 5.5v5.5h2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="13.2" y="2.5" width="5" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="13.2" y="13.5" width="5" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    key: 'blog',
    to: '/blog',
    title: '博客 · 知识库',
    desc: '树形文章、双链、知识库 · 资产 · 日记 · 书签',
    box: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2H15a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 16.5v-13Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M7 6h6M7 9.5h6M7 13h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'gamemap',
    to: '/gamemap',
    title: '剧情图谱',
    desc: '游戏人物关系画布 · 剧情时间线 · 图鉴',
    box: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="5.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="14.5" cy="7" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="9" cy="15" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.2 6.1 12.6 6.7M13.6 8.9 10.4 13.2M6.9 6.9 8.4 13.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'todo',
    to: '/todo',
    title: '待办 · 四象限',
    desc: 'MyTodo 迁入 · 今日看板 · 规律生活计划',
    box: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 7.5h14M7.5 3v14" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 11l1.6 1.6L10.8 9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'practice',
    to: '/practice',
    title: '刷题 · 算法练习',
    desc: 'LeetCode / 洛谷 · 题解与代码 · 艾宾浩斯复习',
    box: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M7 4.5 3 10l4 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 4.5 17 10l-4 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'steamidler',
    to: '/steamidler',
    title: 'Steam 挂机',
    desc: '账号挂机 · 时长统计 · 运行日志',
    box: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M6.8 6h6.4A3.3 3.3 0 0 1 16.5 9.3v1.2a3 3 0 0 1-5.3 1.9l-.5-.6H9.3l-.5.6a3 3 0 0 1-5.3-1.9V9.3A3.3 3.3 0 0 1 6.8 6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6.9 9v2.6M5.6 10.3h2.6M12.9 9.6h.01M14.2 11h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'subs',
    to: '/subs',
    title: '订阅管理',
    desc: '会员订阅 · 支出统计 · 到期日历',
    box: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M3.2 6.5l3.3 3.3L10 5l3.5 4.8 3.3-3.3-1 8.5H4.2l-1-8.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'vault',
    to: '/vault',
    title: '密码库',
    desc: '零知识端到端加密 · 密码服务 · 安全中心',
    box: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l6 2.4v4.5c0 3.9-2.6 7.2-6 8.6-3.4-1.4-6-4.7-6-8.6V4.4L10 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="10" cy="9" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 11v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'apihub',
    to: '/apihub',
    title: 'API Hub',
    desc: '异构 API 聚合 · 平台令牌 · 多级限流 · 一键探活',
    box: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.8 4.8l2.1 2.1M13.1 13.1l2.1 2.1M15.2 4.8l-2.1 2.1M6.9 13.1l-2.1 2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'config',
    to: '/config',
    title: '系统配置',
    desc: '数据库一键切换（SQLite/PG）· 日志上报',
    box: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M4 6.5h8M14 6.5h2M4 13.5h2M8 13.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="13" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="7" cy="13.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    key: 'confcenter',
    to: '/confcenter',
    title: '配置中心',
    desc: 'namespace → key → value · Redis 缓存',
    box: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <ellipse cx="10" cy="4.8" rx="6" ry="2.3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 4.8v10.4c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3V4.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M4 10c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'logs',
    to: '/logs',
    title: '日志查询',
    desc: 'lizysdk 接收端 · 检索与统计',
    box: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M3 5h14v10H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5.5 8l2 2-2 2M9.5 12h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'clash',
    to: '/clash',
    title: 'Clash 代理',
    desc: 'clashctl Web 化 · 内核启停 · 订阅 · Tun',
    box: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 10h14M10 3c2.5 2 2.5 12 0 14M10 3c-2.5 2-2.5 12 0 14" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    key: 'devtoolbox',
    to: '/devtoolbox',
    title: '开发者工具箱',
    desc: '31 个工具 · JSON / Diff / 编码 / 哈希 / 正则',
    box: 'bg-lime-500/10 text-lime-600 dark:text-lime-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M12.8 3.4a2.6 2.6 0 0 1 3.7 3.7l-1.9 1.9-3.7-3.7 1.9-1.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="m10.1 6.1-6.5 6.5a2.6 2.6 0 0 0-.7 1.3l-.5 2.7 2.7-.5a2.6 2.6 0 0 0 1.3-.7l6.5-6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m9 11 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
]

export const SYS_BY_KEY = Object.fromEntries(SYSTEMS.map(s => [s.key, s]))
