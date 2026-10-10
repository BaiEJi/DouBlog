#!/usr/bin/env bash
# MyTodo APK 一键构建 + 蒲公英分发
# 用法:
#   ./upload_pgyer.sh                  # 构建 release 并上传,更新说明默认取 git 最近提交
#   ./upload_pgyer.sh "修复了xx问题"    # 自定义更新说明
#
# 密钥从同目录 pgyer.key 读取(该文件已 gitignore,不会提交到仓库)
set -e
cd "$(dirname "$0")"

# ---- 配置 ----
API_KEY=$(head -1 pgyer.key | tr -d '\r\n ')
USER_KEY=$(sed -n 2p pgyer.key | tr -d '\r\n ')   # 上传用不到,其他openapi备用
if [ -z "$API_KEY" ]; then echo "缺少 pgyer.key (第1行API Key, 第2行User Key)"; exit 1; fi

APK_REL="app/build/outputs/apk/release/app-release.apk"
APK_OUT="MyTodo.apk"

# ---- 构建 ----
echo "==> 构建 release APK..."
export JAVA_HOME="D:/android-dev/jdk"
export GRADLE_USER_HOME="D:/android-dev/gradle-home"
/d/android-dev/gradle/gradle-8.7/bin/gradle.bat assembleRelease --console=plain -q
cp -f "$APK_REL" "$APK_OUT"

VER=$(/d/android-dev/android-sdk/build-tools/34.0.0/aapt.exe dump badging "$APK_OUT" | grep -o "versionName='[^']*'" | head -1 | cut -d"'" -f2)
VERCODE=$(/d/android-dev/android-sdk/build-tools/34.0.0/aapt.exe dump badging "$APK_OUT" | grep -o "versionCode='[^']*'" | head -1 | cut -d"'" -f2)
echo "==> v$VER ($VERCODE)  $(ls -la "$APK_OUT" | awk '{print $5}') bytes"

# ---- 更新说明 ----
if [ -n "$1" ]; then
    DESC="$1"
else
    DESC=$(git log -1 --pretty=format:%s 2>/dev/null || echo "v$VER 更新")
    DESC="v$VER: $DESC"
fi
echo "==> 更新说明: $DESC"

# ---- 上传蒲公英 ----
echo "==> 上传中..."
RESP=$(curl -s -X POST "https://upload.pgyer.com/apiv2/app/upload" \
    -F "_api_key=$API_KEY" \
    -F "file=@$APK_OUT" \
    -F "buildInstallType=1" \
    -F "buildUpdateDescription=$DESC")

echo "$RESP" | python -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('响应解析失败:'); print(sys.stdin.read() if False else ''); raise SystemExit(1)
code = d.get('code')
if code != 0:
    print(f'上传失败 code={code}: {d.get(\"message\")}'); raise SystemExit(1)
data = d.get('data', {})
print()
print('✅ 上传成功')
print(f\"  应用:   {data.get('buildName')} ({data.get('buildIdentifier')})\")
print(f\"  版本:   {data.get('buildVersion')} ({data.get('buildVersionNo')})\")
print(f\"  大小:   {int(data.get('buildFileSize', 0)) // 1024} KB\")
print(f\"  下载页: https://www.pgyer.com/{data.get('buildShortcutUrl')}\")
print(f\"  二维码: {data.get('buildQRCodeURL')}\")
"
