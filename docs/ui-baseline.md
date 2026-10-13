# DouBlog UI 一致性基线（v1，2026-10）

> 目的：各能力包在不同时期开发，视觉档位漂移。本基线统一**同类元素的尺寸/圆角/边框/间距档位**；
> **不重设计**——各模块的个性色与布局结构保持不变，只对齐档位。
>
> 个性色现状（2026-10 校准）：blog=stone（顶栏"新建"主按钮为 amber 实底）、diary=rose、subs=amber
> （历史现状，门户卡标注 violet 仅为图标底）、vault/pwsvc=emerald、apihub=amber、config=teal、logs=sky、
> todo=indigo、confcenter=cyan；门户"剧情图谱"卡 violet、"刷题"卡 blue（均为图标底）。
> 个性色只用于：图标底、徽章、主按钮、选中态；其余一律中性 stone。

## 档位表（Tailwind 类为准）

| 元素 | 基线 |
|---|---|
| 页面底色 | `bg-stone-50 dark:bg-[#100f0e]`（全站统一；已是 `#fafafa/#0a0a0a` 的页面切到本档） |
| 页面大标题（页首 H1） | `text-2xl font-semibold tracking-tight`（门户级大标语才用 30-34px；**sticky 密集工具栏例外档 `text-lg`**，如 /logs 顶栏） |
| 区块标题 | `text-base font-semibold` |
| 卡片标题 | `text-[15px] font-medium` 或 `text-sm font-semibold` |
| 正文/控件文字 | `text-sm`（14px 基准；表格单元格同） |
| 辅助/描述文字 | `text-xs text-stone-500 dark:text-stone-400`（12-12.5px） |
| 微注/页脚 | `text-[11.5px] text-stone-400 dark:text-stone-500` |
| 卡片容器 | `rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5`（大容器 `rounded-3xl p-6/8`） |
| 输入框 | `text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] outline-none focus:border-black/30 dark:focus:border-white/30` |
| 主按钮 | `text-sm font-medium px-4 py-2 rounded-lg` + 实底 `bg-stone-900 dark:bg-stone-100`（或模块主色实底） |
| 次按钮 | 同尺寸 + `bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]` |
| 危险按钮 | `text-red-600 dark:text-red-400` 文字或 `bg-red-500/10` 底 |
| 徽章/标签 | `text-[11px]~text-xs px-2 py-0.5 rounded-md` 或 `rounded-full px-2.5 py-1` + `<色>-500/10` 底 + `-600/-400` 字 |
| 图标按钮 | `w-9 h-9 rounded-xl`（小场景 `w-8 h-8 rounded-lg`），strokeWidth 1.4-1.5 |
| SVG 图标 | `w-4 h-4`~`w-5 h-5`，`viewBox="0 0 20 20"`，stroke 1.4/1.5 |
| 表格/列表行 | 行高 `py-2.5`，分隔 `divide-y divide-black/[0.06] dark:divide-white/[0.06]` |
| 模态 | 居中卡片 `rounded-2xl` + 遮罩 `bg-black/40`，标题 `text-base font-semibold`，按钮行右对齐 |
| toast/提示条 | `rounded-lg px-3 py-2 text-[13px]` + 语义色 `/10` 底 |
| ID/哈希/连接串 | `font-mono text-xs` |
| 数字统计 | `text-lg~xl font-semibold tabular-nums` |

## 硬性检查项

1. **暗色完整**：所有新增/修改的类必须带 `dark:` 变体；不得出现暗色下白底/黑字不可读
2. **新前端目录必须加 `@source "./目录";`**（index.css 白名单，漏加该目录工具类静默不生成）
3. 同页同类元素档位一致（同页两个按钮不许一个 px-3 一个 px-4）
4. 移动端：栅格 `grid-cols-1 sm:grid-cols-*`，容器 `px-4 sm:px-6`

## 执行口径

- 模块外壳统一使用 `shared/ModuleShell.jsx`：220px 侧栏、递归 children 菜单、同一内容画布（max-width 1700px，水平 16/24/40px、上下 32px）。不得重复添加全局容器留白；业务表格/编辑器/画布内部布局按功能保留。
- PageHeader 仅注册导航和展示内容标题；模块主题控制集中于公共侧栏。移动端使用带 Escape、焦点循环和滚动锁定的抽屉导航。
- 个性色保留：模块主色只用在图标底、徽章、主按钮；其余中性 stone
- 改完目视自查明暗两态；构建由主线统一执行
