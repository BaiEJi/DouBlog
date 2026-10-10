"""把扩展打成单个 zip 分发包。

用法: python pack.py [输出路径]
默认输出到仓库根: ../MyTodo-extension-<manifest版本>.zip
内容为运行时必需文件(剔除 test-page.html / serve_test.py / 本脚本 等开发文件)。
安装: 解压任意目录 → chrome://extensions → 开发者模式 → 加载已解压的扩展程序。
"""
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# 运行时文件清单(manifest 引用 + README);新增运行时文件需同步维护
RUNTIME_FILES = [
    'manifest.json',
    'background.js',
    'content.js',
    'popup.html', 'popup.css', 'popup.js',
    'options.html', 'options.css', 'options.js',
    'theme.css',
    'js/config.js', 'js/storage.js', 'js/api.js', 'js/notify.js',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
    'README.md',
]


def main():
    manifest = json.load(open(os.path.join(HERE, 'manifest.json'), encoding='utf-8'))
    version = manifest.get('version', '0.0.0')
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(HERE), f'MyTodo-extension-{version}.zip')

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in RUNTIME_FILES:
            path = os.path.join(HERE, name)
            if not os.path.isfile(path):
                print(f'!! 缺少文件: {name}')
                sys.exit(1)
            z.write(path, name)
    size = os.path.getsize(out)
    print(f'已打包: {out} ({size/1024:.1f} KB, {len(RUNTIME_FILES)} 个文件, v{version})')


if __name__ == '__main__':
    main()
