# MyTodo Android 客户端

MyTodo 四象限待办系统的原生 Android 客户端。零第三方依赖（无 androidx / material / okhttp / coroutines），UI 全部使用 `android.widget` 程序化构建，网络使用 `HttpURLConnection` + `org.json`。

## 安装 APK

- 现成的安装包：`MyTodo-debug.apk`（与本 README 同目录），也可以自行构建（见下文）。
- 将 APK 传到手机（微信/QQ 文件传输、USB、网盘均可），在文件管理器中点击安装。
- 安装时需允许「安装未知来源应用」权限。要求 Android 8.0（API 26）及以上。

## 配置服务器地址

1. 启动 App，点击右上角 ⚙ 进入设置。
2. **服务器地址**：填写运行 MyTodo 后端的电脑的局域网地址，例如 `http://192.168.1.100:8070`（手机和电脑须在同一局域网；查看电脑 IP：`ipconfig` 中的 IPv4 地址）。
   - Android 模拟器请填 `http://10.0.2.2:8070`（模拟器访问宿主机）。
3. **访问 Token**：已预填默认 Token，一般无需修改；如后端更换认证，粘贴新 Token。
4. 点击保存返回，主界面自动刷新。

## 功能

- 顶栏：今日日期（M月d日 周X）、连续打卡天数、待迁移任务橙色徽标、设置入口
- 2×2 四象限卡片（Q2 计划做·左上，Q1 立即做·右上，Q4 考虑删除·左下，Q3 委派·批量·右下）：
  - 彩色顶条 + 象限名 + 待办数徽章 + 任务列表（每卡最多显示 5 条，超出折叠提示）
  - 任务行：勾选圆圈（点击完成/重开）、标题、类别色点与名称、迁移标记（⟲ 原始日期 · 拖N天）、完成任务划线并淡化
- 右下角 FAB 新建任务：标题 + 四象限单选色块 → `POST /api/v1/tasks`
- 待迁移对话框：逐条「迁到今天」或「全部迁到今天」（排除需干预项）→ `POST /api/v1/migrations/bulk`

## 构建

依赖环境（均安装在 `D:\android-dev\`）：

| 组件 | 版本 | 路径 |
| --- | --- | --- |
| JDK | Eclipse Temurin 17.0.20.1 | `D:\android-dev\jdk` |
| Android SDK | cmdline-tools + platform-tools + platforms;android-34 + build-tools;34.0.0 | `D:\android-dev\android-sdk` |
| Gradle | 8.7 | `D:\android-dev\gradle\gradle-8.7` |

构建命令（Git Bash）：

```bash
export JAVA_HOME='D:\android-dev\jdk' ANDROID_HOME='D:\android-dev\android-sdk' GRADLE_USER_HOME='D:\android-dev\gradle-home'
cd /c/Users/Lizy/Desktop/Code/MyTodo/android
/d/android-dev/gradle/gradle-8.7/bin/gradle.bat assembleDebug --no-daemon
```

产物：`app/build/outputs/apk/debug/app-debug.apk`

## 项目结构

```
android/
├── settings.gradle            # 插件仓库与模块声明
├── build.gradle               # AGP 8.5.0 / Kotlin 1.9.24
├── gradle.properties
├── local.properties           # sdk.dir（不入库）
├── MyTodo-debug.apk           # 构建产物副本
└── app/
    ├── build.gradle           # compileSdk 34 / minSdk 26 / targetSdk 34，零依赖
    └── src/main/
        ├── AndroidManifest.xml    # INTERNET + usesCleartextTraffic
        ├── java/com/mytodo/app/
        │   ├── MainActivity.kt    # 四象限主界面、FAB、迁移/新增对话框
        │   ├── SettingsActivity.kt# 服务器地址与 Token 设置
        │   └── ApiClient.kt       # HTTP 封装（?token= 查询参数）
        └── res/
            ├── values/styles.xml  # Theme.Material.Light.NoActionBar
            └── drawable/ic_app.xml# 矢量图标
```
