export const MODULES = {
  blog: { title: '博客 · 知识库', subtitle: '文章 · 双链 · 知识库 · 资产', accent: 'amber', items: [
    { key: 'blog', label: '知识库', to: '/blog', children: [
      { key: 'create', label: '新建文章', to: '/create' },
    ] },
    { key: 'assets', label: '资产库', to: '/assets', children: [
      { key: 'prompt', label: 'Prompt' }, { key: 'skill', label: 'Skill' },
    ] },
    { key: 'diary', label: '日记', to: '/diary', children: [
      { key: 'timeline', label: '时间线' }, { key: 'calendar', label: '日历' }, { key: 'heatmap', label: '热力图' },
      { key: 'stats', label: '统计' }, { key: 'trash', label: '回收站' },
    ] },
    { key: 'bookmarks', label: '书签 · 稍后阅读', to: '/bookmarks', children: [
      { key: 'shelf', label: '收藏夹' }, { key: 'queue', label: '稍后阅读' }, { key: 'stats', label: '统计' },
      { key: 'tools', label: '工具' }, { key: 'trash', label: '回收站' },
    ] },
  ] },
  subs: { title: '订阅管理', subtitle: '会员 · 支出 · 到期提醒', accent: 'amber' },
  todo: { title: 'MyTodo', subtitle: '四象限 · 迁移 · 规律生活', accent: 'indigo' },
  practice: { title: '刷题', subtitle: '题解 · 代码 · 艾宾浩斯复习', accent: 'blue' },
  steamidler: { title: 'Steam 挂机', subtitle: '账号 · 挂机时长 · 日志', accent: 'slate', items: [{ key: 'accounts', label: '账号管理' }] },
  gamemap: { title: '剧情图谱', subtitle: '游戏 · 人物 · 关系', accent: 'violet' },
  mindmap: { title: '思维导图', accent: 'teal', items: [{ key: 'library', label: '我的导图', to: '/mindmap' }] },
  vault: { title: '密码库', subtitle: '条目 · 安全中心 · 密码服务', accent: 'emerald' },
  apihub: { title: 'API Hub', subtitle: '系统 · API · 平台令牌', accent: 'amber' },
  logs: { title: '日志查询', subtitle: '检索 · 统计 · 告警', accent: 'sky', items: [{ key: 'search', label: '日志检索' }] },
  config: { title: '系统配置', subtitle: '账号 · 数据库 · 日志上报', accent: 'teal', items: [{ key: 'config', label: '系统配置' }] },
  confcenter: { title: '配置中心', subtitle: 'namespace → key → value', accent: 'cyan', items: [{ key: 'entries', label: '配置管理' }] },
  clash: { title: 'Clash 代理', subtitle: '内核 · 订阅 · Tun · Mixin', accent: 'sky' },
  devtoolbox: { title: '开发者工具箱', subtitle: 'JSON · Diff · 编码 · 哈希 · 正则', accent: 'lime' },
}
export const moduleKeys = Object.keys(MODULES)
export const MODULE_ALIASES = { post: 'blog', create: 'blog', assets: 'blog', diary: 'blog', bookmarks: 'blog' }
