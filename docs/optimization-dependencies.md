# 全模块优化的组件选择与依赖验收

本轮新增组件通过本地适配器使用，版本由 npm lockfile / Python requirements 固定。没有把上游示例应用、额外数据库、调度服务或另一套画布引入产品。

| 组件 | 验收版本 | 许可证 | 用途/边界 |
|---|---|---|---|
| [TanStack Virtual](https://github.com/TanStack/virtual) | 3.14.21 | MIT | 共享动态行高虚拟列表；真实浏览器验收10000行、DOM少于100且末行可达 |
| [CodeMirror](https://codemirror.net/) | view 6.43.15/state 6.7.6/commands 6.11.1/language 6.13.1；JSON 6.0.2/JS 6.2.5/Markdown 6.5.2/theme 6.1.3 | MIT | 共享编辑器；保留textarea兼容桥、撤销、只读与主题；不引入Monaco第二套运行时 |
| [jsdiff](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause | 替代二次方LCS；在Worker执行，支持预算/超时，完整结果不静默截断 |
| [markdownify](https://pypi.org/project/markdownify/1.2.3/) | 1.2.3 | MIT | 已选HTML主体转换；保留表格、嵌套列表、代码与上下标；不负责联网下载 |
| [Beautiful Soup](https://pypi.org/project/beautifulsoup4/4.15.0/) | 4.15.0 | MIT | HTML结构解析与主体候选评分；配套SoupSieve 2.10 |
| [ELK.js](https://github.com/kieler/elkjs) | 0.12.0，隔离PoC | EPL-2.0 OR GPL-3.0-or-later | 未加入正式依赖；按EPL路径评估。现有直线边下降低部分交叉但扩大布局，不替换手工布局/ReactFlow |
| [HTTPX](https://www.python-httpx.org/) | 0.28.1，已有依赖 | BSD-3-Clause | 网关候选传输PoC与本地mock；现有标准库池保留，严格总截止时间语义优先 |

CodeMirror仓库有迁移，新版 npm 元数据指向 `code.haverbeke.berlin`；旧GitHub归档不能单独解释为停止维护。适配器与锁定版本仍需跟随升级回归。Trafilatura暂未加入：本轮选择轻量转换和固定语料验收，后续只有抽取质量不足才评估额外依赖。ELK的折线bendpoints没有应用到当前自绘直线边，不能把上游指标当作现有UI收益。

## 兼容升级与审计

通过官方 npm registry 安装新增精确版本，并对现有依赖做兼容漏洞修复。随后将 KaTeX 固定到0.19.0，传递依赖覆盖到同版；postcss-selector-parser覆盖到7.1.7，SimpleMindMap的uuid覆盖到11.1.1（仅使用v4 API）。没有运行强制降级导图库的 `audit fix --force`。

审计由初始20条报告降到2条低风险报告：Quill2.0.3的HTML导出XSS与其父SimpleMindMap传播报告。当前导图适配器不加载Quill/RichText/Formula插件，导入也拒绝富文本，剩余依赖树报告不等于该路径可达。上游没有可直接替换的Quill补丁版，npm建议的导图库降级与锁定私有测量扩展不兼容，因此记录而未掩盖。最终生产构建已记录2903个rendered modules、226个chunk；Quill、RichText、Formula及导图库旧嵌套KaTeX在所有rendered chunk中均为0。普通dist与审计构建逐文件SHA相同，证据为`frontend-bundle-comparison.json`，因此没有以另一份构建替代正式产物证明。

KaTeX升级已走真实Markdown渲染：行内/块公式、表格内公式、代码转义均通过，并检查明暗截图；完整导图浏览器13项流程也已通过。最终全量测试与构建以统一验收记录为准。

## PoC结果

ELK以真实Worker执行，100节点/297边：直线交叉5264→3793（约-28%），占用3268×1880→10612×5046，计算777ms；500节点/1499边：128785→115752（约-10%），占用7688×4280→22394×26496，计算3717ms。两组均无节点重叠，主线程未观察到long task。500节点面积约18倍，会使fit后的文字更小，故本轮不引入。原始结果位于隔离验收的 `elk-poc/results.json`，最终报告汇总来源与环境。

## 最终组件实测与成本

- HTTPX候选与现有标准库传输各用同样的SDK池、回环echo、1000请求、并发1/16/64、三个交替轮次，18000个业务响应全部正确。中位吞吐分别为：标准库1486/2485/2633 rps，HTTPX886/763/659 rps；p95分别0.88/9.95/37.32ms与1.49/39.99/190.21ms。候选没有通过性能与严格总deadline门槛，生产继续使用标准库；该结果不是公网/TLS性能结论。
- 固定5组离线结构语料、每组30次：markdownify保留14/14标记，legacy为8/14；新适配器wall耗时中位12.2–14.6ms，旧适配器0.08–0.11ms（perf_counter测经过时间）。采用理由是表格、列表、代码和上下标保真，不能称为CPU提速；legacy显式适配入口保留。
- 原锁文件与当前锁文件独立生产构建：初始静态JS闭包gzip82302→89947字节（+7645）；全部生产JS（含entry、lazy、worker）合计2341947→2653836字节（+13.3%），后者不是首屏传输量。新增CodeMirror/Lezer相关懒加载chunk约201.3kB gzip。新增编辑与Worker能力有包体成本，完整路由闭包与计算方法见前端验收记录。
- 原始结果：`.ui-qa/optimization/transport-performance.json`、`html-performance.json`、`frontend-bundle-comparison.json`；工具记录输入源码hash并核对测量中未变化。全部UI与后端最终回归另见统一实施记录。
