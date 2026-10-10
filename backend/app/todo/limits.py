"""每日任务容量上限(服务端硬限制,web / APK / Chrome 共用同一 API)。

一键更改:直接改下面的常量并重启后端,全局生效;客户端无需任何改动。

统计口径:
- 只统计"当天原生"任务:task_date = 当天 且 original_date >= 当天(或为空);
  历史任务迁移进当天(original_date < 当天)不计入,也不受此限制约束。
- 按未删除任务计(pending + done 均算),deleted 不算。
"""

# 单个象限每天最多任务数
QUADRANT_DAILY_LIMIT = 8

# 四个象限每天合计最多任务数
DAY_TOTAL_LIMIT = 30
