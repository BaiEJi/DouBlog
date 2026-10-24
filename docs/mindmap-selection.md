# 思维导图核心选型与适配边界

调研日期：2026-10-19。开发前实际读取了两个官方仓库、各自文档、许可证和关键源码；随后用本地安装的 `simple-mind-map@0.14.0-fix.3` 核对命令与插件接口。以下区分上游能力、DouBlog 实现和未测性能，不把产品宣传当成验证结果。

## 选型结论

采用 **SimpleMindMap 的 JavaScript 库**，通过 `frontend/src/mindmap/adapter.js` 接入 React，不复用它的 Vue 2 示例应用。它现有布局和节点插件与本次完整需求相符，能够直接复用组织图、鱼骨、时间轴、关联线、概要及多格式转换，避免自行开发布局算法。两个候选都与框架无关，均可由 React `ref` 持有 DOM 容器，用 effect 初始化一次并在卸载时销毁；React 19/Vite 8 的实际兼容性以本项目构建和浏览器验收为准。[SimpleMindMap 仓库](https://github.com/wanglin2/mind-map)、[Mind Elixir 仓库](https://github.com/ssshooter/mind-elixir-core)。

| 维度 | SimpleMindMap | Mind Elixir |
|---|---|---|
| 模块与框架 | `module: index.js`，不依赖 Vue/React；按插件引入 | ESM，TypeScript 声明，框架无关；仓库提供 React 示例 |
| 布局覆盖 | 双向导图、左右逻辑图、组织图、目录、鱼骨、横/竖时间轴 | 当前源代码方向为 `LEFT/RIGHT/SIDE/DOWN`；鱼骨和时间轴需补布局 |
| 典型编辑 | 节点增删、剪贴板、拖动、多选、撤销、展开折叠 | 同样有节点编辑、多选、历史、拖动 |
| 节点内容 | 文本/格式、图像、图标、备注、链接、标签、概要 | 节点样式、图像、图标、标签、链接、备注；Markdown 渲染可注入解析器 |
| 非树结构 | `AssociativeLine`；概要为节点数据的 `generalization` | 核心 `arrows` 和 `summaries` |
| 全局导航 | `Search`、`MiniMap`，大纲/聚焦由业务层实现 | 有聚焦能力；大纲和小地图仍需业务界面或扩展 |
| XMind | 官方解析器导入，`ExportXMind` 导出 | 官方生态有独立导出插件；本次未查到核心内置 XMind 导入 |
| 维护成本 | 功能覆盖较好，但依赖较多且已宣布低维护 | 核心轻、维护更活跃；补齐布局和格式转换成本较高 |

布局比较核对了 [SimpleMindMap Render 布局注册](https://raw.githubusercontent.com/wanglin2/mind-map/main/simple-mind-map/src/core/render/Render.js) 与 [Mind Elixir 方向常量入口](https://raw.githubusercontent.com/ssshooter/mind-elixir-core/master/src/index.ts)。Mind Elixir 的数据类型、Markdown 与扩展字段见 [类型声明](https://raw.githubusercontent.com/ssshooter/mind-elixir-core/master/src/types/index.ts)；独立 XMind 导出需要 `@mind-elixir/export-xmind`、`jszip`、`file-saver`，见 [官方插件仓库](https://github.com/ssshooter/export-xmind)。

## 已采用的原生接口与业务补齐

本版使用基础文本格式，对整个节点应用加粗、斜体、下划线、字体、字号和颜色；不注册 Quill，不接收富 HTML。上游 `RichText` 可以支持文本片段格式，但其 `foreignObject` 渲染会增加安全和导出测试范围，若未来启用需独立评估。[RichText 文档](https://wanglin2.github.io/mind-map-docs/plugins/richText.html)。

每张导图只有一个根主题，创建导图时建立；根的删除和剪切被适配层禁止。上游不支持多个自由根，也不支持在概要后继续添加节点；若以后要支持自由画板，应作为单独产品范围评估，不能把当前功能宣称为多根画布。[上游特性边界](https://raw.githubusercontent.com/wanglin2/mind-map/main/README_MORE_EN.md)。

| 能力 | 实际接口与归属 |
|---|---|
| 插件注册 | `MindMap.usePlugin(Drag/Select/KeyboardNavigation/AssociativeLine/Search/MiniMap)`，仅适配层引用 |
| 节点与批操作 | `execCommand('INSERT_CHILD_NODE'/'INSERT_NODE'/'REMOVE_NODE'/'SET_NODE_STYLES', ...)`；原生命令处理历史，适配层附加根保护、参数校验、只读守卫 |
| 移动与排序 | `MOVE_NODE_TO`、`INSERT_BEFORE`、`UP_NODE`、`DOWN_NODE`；拖动由 `Drag` 插件处理 |
| 概要 | `ADD_GENERALIZATION`；不能作为新的树根，不能在概要后追加子节点 |
| 关联线 | `associativeLine.addLine(from,to)` 或 `createLineFromActiveNode()`；重复连线由插件过滤 |
| 定位 | `GO_TARGET_NODE(uid,callback)` 自动展开祖先路径；适配层搜索完整数据树并返回 UID 列表 |
| 保存/加载 | `getData(true)` 获取原生完整文档；整图加载才使用 `setFullData`；常规编辑通过命令更新，不重建实例 |
| 结束输入 | `commit()` 同步结束当前节点输入、通知内容变化并返回完整文档；手动保存、导出、离开恢复与清理都先提交最后字符 |
| 生命周期 | 首次 `node_tree_render_end` 和两帧绘制后完成初始化；`destroy()` 解绑插件与事件；适配层同时清理 observer、计时器、tooltip 和小地图 |
| 大纲/聚焦 | DouBlog 业务界面；聚焦编辑后把分支按 UID 合并回完整树，自动保存和导出仍使用完整文档 |
| 小地图 | 注册原生 `MiniMap`，保留 `getMiniMap()`；实时导航采用缓存布局坐标的 Canvas，平移只更新视口框，避免高频克隆整个 SVG |
| 深色/只读 | 跟随系统主题调整显示配置，不把主题切换或平移缩放当成内容编辑；只读模式同时拦工具命令、快捷键、节点编辑与关联线控制点修改 |

命令、数据读写和清理依据 [实例方法](https://wanglin2.github.io/mind-map-docs/api/constructor/constructor-methods.html)；关联线依据 [插件 API](https://wanglin2.github.io/mind-map-docs/plugins/associativeLine.html)；小地图开销核对了 [原生 MiniMap 源码](https://raw.githubusercontent.com/wanglin2/mind-map/main/simple-mind-map/src/plugins/MiniMap.js)。搜索插件可用于循环定位和替换，事件包含当前索引与结果数，见 [Search 文档](https://wanglin2.github.io/mind-map-docs/plugins/search.html)。

## 数据格式与导入导出

产品 JSON 使用独立的 `doublog.mindmap` 信封，保存导图身份、名称、schema_version、revision 和 document。原生 document 为 `{root,layout,theme:{template,config},view}`；节点为 `{data:{uid,text,expand,...},children:[]}`，数组顺序即同级顺序。节点属性、备注、标签、链接、图片、样式、概要和关联线字段随 JSON 保留。自定义节点业务字段按上游约定使用 `_` 前缀，避免被误判为样式。原生树格式依据 [实例选项数据结构](https://wanglin2.github.io/mind-map-docs/api/constructor/constructor-options.html)；完整文档字段已对照 [getData 实现](https://raw.githubusercontent.com/wanglin2/mind-map/main/simple-mind-map/index.js)。

| 格式 | 提供者 | 本版边界 |
|---|---|---|
| DouBlog JSON | 业务数据/API 层 | 唯一完整备份和往返格式，导入先验证再替换；浏览器下载和服务端 API 使用同一信封 |
| Markdown | 上游依赖 mdast 解析器、业务树装配与上游 `Export` | 标题/段落/列表导入；多个顶级主题以文件名包成单根，全部保留；不保留完整样式、关系、折叠、身份或修订信息 |
| SVG / PNG | 上游 `Export` | 视觉输出，不能重新编辑还原数据；跨域图像受 CORS 限制，巨大画布受浏览器栅格尺寸/内存限制 |
| XMind | `parse/xmind.js`、`ExportXMind` | 可交换主题树、备注、链接、标签、图片及部分概要；不是完整备份，样式、非树关联线与原始布局不保证保留 |

XMind 导入使用 `parseXmindFile(file)`，支持压缩包中的 `content.json` 和旧 `content.xml`；存在多个画布时当前采用首个画布。导出源码固定使用向右逻辑结构并跳过样式转换，因此不能声称 XMind 无损。[解析器 API](https://wanglin2.github.io/mind-map-docs/api/xmind.html)、[XMind 转换源码](https://raw.githubusercontent.com/wanglin2/mind-map/main/simple-mind-map/src/parse/xmind.js)。导出插件的 PNG/SVG/Markdown API 和独立 `ExportXMind` 注册方式见 [Export 文档](https://wanglin2.github.io/mind-map-docs/plugins/doExport.html)。

外部文件解析不会直接改当前画布；校验通过后由业务层决定保存为新导图或替换。适配层为外部主题/概要补 UID，对压缩包条目和声明解压体积限额；业务数据层进一步检查 10 MB、10000 节点、128 层、重复 UID、循环/原型属性、URL 与不支持的富文本。SVG 节点图片不接收。

Markdown 上游转换器只返回首棵顶层树，因此本版直接复用其 `mdast-util-from-markdown` 解析依赖，由业务层装配单根，不直接调用会遗漏其他根的转换方法。XMind 的多画布仍取首个，这是已明确的有损导入边界；需要保留全部画布时应分别导入或先转换为多份标准 JSON。复制/剪切始终保留内部缓冲，系统剪贴板权限失败会显示原因，并允许在当前导图继续粘贴。

## 性能依据、实现措施与验证方式

没有依据证明任一候选天然满足 1000/5000 节点、所有操作 100 ms、动画 60 FPS。SimpleMindMap 官方明确提醒大规模节点可能卡顿；它的 `openPerformance` 是视窗裁剪，只渲染可见节点，导出则补渲染全图。因此不能用裁剪后的 DOM 数或折叠多数节点来证明全量压力测试通过。[上游性能说明](https://wanglin2.github.io/mind-map-docs/start/introduction.html)。Mind Elixir 的高性能宣传同样不是可复现的设备/数据基准。[官方介绍](https://docs.mind-elixir.com/docs/getting-started/intro)。

本版保留全部已展开节点，`openPerformance:false`，复用原生 transform 平移缩放与节点缓存。选择变化不写库，画布位移不触发自动保存；文本不逐字重新排版；历史上限设 80 次控制全树快照内存；小地图不按鼠标事件克隆 SVG。文档替换、聚焦切换与主题切换才允许完整布局更新，节点编辑走原生命令。100/1000/5000 使用固定四叉树数据并记录实际 DOM 数；性能工具记录初始化、编辑、展开折叠、真实鼠标重挂、搜索定位、实际鼠标平移/滚轮缩放、JSON 导出和重新导入、长任务、帧间隔及可用内存指标；SVG/PNG/XMind/Markdown 实际下载由独立 25 节点核心集成测试验证，不宣称完成 5000 节点位图导出压力测试。结果以执行产生的报告为准。

开发中的首轮 1000 节点初始化观测为 5153 ms，促使检查纯文本测量路径；该轮测量还含可剥离的等待开销，不代替最终基准。源码 `nodeCreateContents.createTextNode` 为每个字符前缀创建临时 SVG Text 并调用 `bbox()` 决定换行，短主题也会多次同步测量。针对这一实际路径增加 `core-text-measure.js` 版本限定插件：Canvas 按字体/宽度/文本缓存换行预测，长行二分寻找断点，最终仍用 SVG `bbox()` 校准真实节点宽高；出现字体外伸溢出时回退原算法。初始化先等 `document.fonts.ready`，不靠估计高度放置节点。该扩展只作用于本适配器的纯文本实例，不修改 node_modules，升级时必须复核私有 `createTextNode` 方法签名。另移除每次 `render_end` 无差别获取并序列化全树的行为，内容事件仍保留。

扩展同时覆盖导出的方法对象和节点 prototype，因为该版本构造函数首次创建节点时会把方法对象复制到 prototype；仅覆盖 prototype 的早期尝试实际计数全为零，不能归功于该优化。最终运行必须核对 `textMeasure.svgMeasurements >= nodeCount` 和 `layoutCorrections > 0`，确保代码真实接入。

另修复了极小缩放下重新导入/编辑的内容偏移：Chrome 124 在 scale≈0.004 时会把正常 154px 文字的 SVG bbox 报告成数百个本地坐标单位。上游使用已附着到缩放画布的 bbox 居中，放大回 1 后会留下负偏移，使文字移出框外。本插件用节点构造时的 `_rectInfo.textContentWidth/Height` 设置内容整体平移，保留原来的图标、标签、链接、备注和图片排列。独立回归对 9 种布局（包括 `timeline2`）执行 scale0.004 编辑/重导入→scale1，校验全部文字仍在形状边界内，包含四种图片位置及右侧/下方标签组合；方法签名与尺寸字段在升级时也需复核。

布局依赖 DOM 测量，直接把整个布局搬到 Worker 无法保持相同计算输入，需先剥离尺寸测量与坐标计算再验证收益；本版没有虚构 Worker 或增量布局加速。可见区域裁剪可作为将来的可选模式，但应独立记录可见节点数、平移补渲染卡顿和导出成本。

最终冻结源码的一轮正式实测见 [性能报告](./mindmap-performance.md) 和 [原始数据](./mindmap-performance.json)：完整渲染与往返的实际 DOM 数均为 100/1000/5000，三个规模的真实拖拽均验证父节点与顺序变化；1000/5000 节点仍未达到全部操作 100ms 与 60FPS 目标。5000 节点编辑反馈约 3.7 秒、拖拽松手后约 6.8 秒，不能把框架无关或优化已接入表述为性能已达标。

## 依赖体积、维护和许可

SimpleMindMap 锁定 `0.14.0-fix.3`，核心依赖包含 SVG.js、deepmerge、eventemitter3、uuid；功能依赖还包括 Quill、KaTeX、JSZip、pdf-lib、xml-js、Yjs 等，完整依赖声明不代表本页面全部打包。本版从 ESM 核心和明确插件入口引入，导出与 XMind/Markdown 解析动态加载，不使用 `full.js` 或 UMD 总包。[上游 package.json](https://raw.githubusercontent.com/wanglin2/mind-map/main/simple-mind-map/package.json)。

本地安装包实测：`dist/simpleMindMap.esm.min.js` 为 **1,605,792 字节**、gzip **516,831 字节**；对应 CSS 为 **24,470 / 3,744 字节**。这只是上游预构建总包的参考，不能当作 DouBlog 页面实际传输体积。测量方法：Node `readFileSync` + `gzipSync`；最终页面分包以本项目生产构建输出为准。

Mind Elixir 官方文档宣称零运行依赖、gzip 33 KB，这是上游口径，并非本次相同构建条件的对照实测。其当前仓库包版本 `5.15.1`、显式 ESM exports，Playwright 测试和 Vite 开发配置较完整；独立导出/Markdown/图像库仍有额外成本。[package.json](https://raw.githubusercontent.com/ssshooter/mind-elixir-core/master/package.json)、[官方体积说明](https://docs.mind-elixir.com/docs/getting-started/intro)。

SimpleMindMap 当前 README 明确开源库/Web 已进入低维护状态，活跃开发转向闭源客户端/插件，且不再提供开发支持；不得将客户端新功能推定为当前开源版能力。Mind Elixir 2026 年仍有多次正式发布，但也有行为兼容变化，例如 `refresh(data)` 不再应用 theme，需显式调用 `changeTheme`。本项目用适配层、锁版本和回归测试吸收上游维护风险。[SimpleMindMap 当前声明](https://github.com/wanglin2/mind-map)、[Mind Elixir releases](https://github.com/SSShooter/mind-elixir-core/releases)。

两个核心均为 MIT，分发时保留各自版权与许可文本；SimpleMindMap 原作者还建议在应用说明中保留来源署名。本文件记录所选核心来源，产品入口也应保留开源项目链接。[SimpleMindMap LICENSE](https://raw.githubusercontent.com/wanglin2/mind-map/main/LICENSE)、[Mind Elixir LICENSE](https://raw.githubusercontent.com/ssshooter/mind-elixir-core/master/LICENSE)。

思维导图编辑核心基于 SimpleMindMap，版权属于 The MindMap Team；本项目的业务数据、API、管理界面和适配层由 DouBlog 维护。

### SimpleMindMap MIT 许可原文

```text
The MIT License (MIT)

Copyright (c) 2021-2023 The MindMap Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
