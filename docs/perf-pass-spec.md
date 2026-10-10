# 模块性能与 SDK 规范化专项（第一步施工合同）

> 2026-10-11。每模块一个子代理执行：审查 → 压测 → 优化 → SDK 检查。骨架（main/db/shared）已由主线完成：trace 中间件 + 日志全局 trace_id 注入 + get_pool 池体系。

## a 代码审查（低效代码）
通读本模块后端代码，标记：N+1 查询、每请求重复计算/重复 IO（可模块级缓存）、循环内 commit、全表扫描可加索引/limit、无意义深拷贝、重复序列化。

## b 压测（先基线）
- 工具：`backend/tools/bench/launch.py`（env：`BENCH_PORT=<你的端口>` `BENCH_DATA=<独立临时目录>` `BENCH_IMPL=fastapi`）+ `npx --yes autocannon`（或 node 内联 API）。
- **各模块端口段**（避免并行冲突）：blog 60210、diary 60220、vault 60230、pwsvc 60240、sdklogs 60250、subs 60260、apihub 60270(+mock 60271)、todo 60280、confcenter 60290。
- 脚本放 `backend/tools/bench/<mod>/bench.py`：起实例 → 造**本模块最小数据**（直接 API 造或 SQL）→ autocannon 2 个代表场景（1 读 + 1 写；`-c 20 -d 10`，预热 3s 丢弃）→ before.json 落盘（rps/p99）。
- 会话认证：先 `POST /api/auth/login` JSON 拿 cookie，autocannon 头带 Cookie。

## c 优化（目标 ≥30%，约束：不加 worker、不引第三方包、只改本模块代码逻辑）
- 顺序：先基线 → 定位真瓶颈（计时插桩/cProfile 单端点）→ 改 → 复测 after.json → 报告 提升百分比 = (after-before)/before。
- **诚实测量**：若实测 <30%，报告真实数字 + 瓶颈分析 + 已做优化清单；禁止通过缩小数据量/换宽松场景制造虚高。
- 常见真瓶颈提示：列表接口 N+1（逐行查关联）、每请求全量拉取后内存过滤（下推到 SQL）、重复解析配置（模块级缓存+失效钩子）、循环内逐条 commit（合并）、响应组装重复 dict 拷贝。
- 行为不变：pytest 必须全绿（契约不破）。

## d SDK 标准化检查（模块内）
1. 新异常路径走 lizysdk AppError 家族（历史 api_response(None,code,msg) 返回式可保留）
2. 无 `ThreadPoolExecutor`/`concurrent.futures`（并发一律 `shared/pools.get_pool`）
3. `shared/modules.py` 的路径前缀映射覆盖本模块全部路由前缀（sys_name 标注正确）——发现缺失报告，**不许改 shared**（报告给主线）
4. 后台线程用 lizysdk 日志时可自然携带 trace/上下文；模块内无 print 调试残留

## 边界
- 只许改：`app/<mod>/**`、`tests/<mod>/`（或 tests/test_<mod>*.py）、`tools/bench/<mod>/**`
- 禁改：app/main.py、app/db.py、app/shared/**、requirements.txt、其他模块、前端
- 测试：`./venv/Scripts/python.exe -m pytest tests/<mod>/ -q -n 4`（不跑全量）
- 完成报告：审查发现清单 / before-after rps 与 p99 / 优化改动点 / 提升百分比 / SDK 检查四项结果 / 遗留
