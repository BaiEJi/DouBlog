# 接口命名规范化审查报告（2026-10-11，第三步）

**结论：前后端 URL 逐一对位零错位，代码层面无 P0**；已修 7 处文档/注释失真（api.md gamemap 六处路径、blog/vault/confcenter api.js 注释、vault 附件 multipart 描述）。

## P1（破坏兼容，仅记录不改）
1. subs 部分更新用 PUT（todo/gamemap 用 PATCH）——统一需改方法
2. sdklogs 前缀 /api/v1（lizysdk send_url 协议兼容，改动破坏已部署 SDK 直发）
3. apihub 密钥池嵌套 GET/POST 与扁平 PUT/DELETE 两种路径并存

## P2（风格项，保持现状）
blog 消歧段寻址 /posts/id/{id}；GET 详情自增浏览（?no_view=1 已缓解）；diary 动作走 query 参数；vault /account 单数；apihub 路径参数缩写；gamemap events 嵌套层级；subs category-summary/by-category 构词与 backup 单数；confcenter ttl 字段名文档；blog 页面组件绕过 api.js 约 10 处（建议渐进收口）。

## 做得好
资源集合复数一致；动作端点动词全原形；query 统一 snake_case；URL 统一 kebab-case；api.js 函数名与语义零错位。
