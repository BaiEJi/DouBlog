# DouBlog 前后端联调 Prompt

> **目标**: 使用此文档指导AI大模型进行前后端联调测试  
> **前提**: 前端和后端已分别开发完成  
> **联调目标**: 确保前后端正常通信、数据格式正确、功能完整

---

## 📋 联调前检查

### 1. 后端检查

**确认后端正常运行：**

```bash
# 进入后端目录
cd /home/lizy/projects/DouBlog/backend

# 激活conda环境
conda activate blog

# 启动后端服务
python run.py
```

**预期输出：**
```
启动 DouBlog v1.0.0
访问地址: http://localhost:60000
 * Running on http://0.0.0.0:60000
```

**测试后端根路径：**

```bash
curl http://localhost:60000
```

**预期返回：**
```json
{
  "message": "Welcome to DouBlog",
  "version": "1.0.0"
}
```

---

### 2. 前端检查

**确认前端正常运行：**

```bash
# 打开新终端，进入前端目录
cd /home/lizy/projects/DouBlog/frontend

# 启动前端服务
npm run dev
```

**预期输出：**
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.x.x:5173/
```

**访问前端：**
- 打开浏览器访问：http://localhost:5173
- 应该看到登录页面

---

## 🔧 联调步骤

### 第1步: 测试认证流程

#### 1.1 测试登录功能

**操作：**
1. 在登录页面输入：
   - 用户名：`admin`
   - 密码：`lizy111A`
2. 点击"登录"按钮

**预期结果：**
- 页面跳转到首页
- 左侧显示文章树（初始为空）
- 右侧显示欢迎信息

**如果失败：**
- 检查浏览器控制台是否有错误
- 检查Network面板，查看`/api/auth/login`请求
- 确认请求Header中包含`Authorization: Basic ...`
- 确认后端日志是否有错误

**后端验证：**
```bash
# 手动测试登录API
curl -X POST http://localhost:60000/api/auth/login \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE="
```

**预期返回：**
```json
{
  "success": true,
  "code": 200,
  "message": "登录成功",
  "data": {
    "username": "admin"
  }
}
```

---

#### 1.2 测试认证拦截

**操作：**
1. 登录后，在浏览器控制台执行：
   ```javascript
   localStorage.removeItem('auth')
   ```
2. 刷新页面

**预期结果：**
- 自动跳转到登录页

**操作：**
1. 直接访问：http://localhost:5173/
2. 不登录

**预期结果：**
- 自动跳转到登录页

---

### 第2步: 测试文章管理功能

#### 2.1 创建根文章

**操作：**
1. 点击"新建文章"按钮
2. 填写表单：
   - 标题：`Java`
   - URL别名：`java`
   - 内容：
     ```markdown
     # Java基础
     
     Java是一门面向对象的编程语言。
     ```
3. 点击"发布"按钮

**预期结果：**
- 文章创建成功
- 页面跳转到文章详情页
- 左侧文章树出现"Java"节点

**后端验证：**
```bash
# 查看文章列表
curl http://localhost:60000/api/posts

# 查看文章树
curl http://localhost:60000/api/posts/tree
```

**预期返回（文章树）：**
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": [
    {
      "id": 1,
      "title": "Java",
      "slug": "/java",
      "level": 0,
      "order": 0,
      "children": []
    }
  ]
}
```

---

#### 2.2 创建子文章

**操作：**
1. 再次点击"新建文章"
2. 填写表单：
   - 标题：`Java8`
   - URL别名：`java8`
   - 父文章：选择"Java"
   - 内容：
     ```markdown
     # Java8新特性
     
     Lambda表达式、Stream API等。
     ```
3. 点击"发布"

**预期结果：**
- 文章创建成功
- 左侧文章树"Java"节点下出现"Java8"子节点
- "Java"节点可以展开/折叠

**后端验证：**
```bash
# 获取Java文章详情
curl http://localhost:60000/api/posts/java
```

**预期返回：**
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": {
    "id": 1,
    "title": "Java",
    "slug": "/java",
    "children": [
      {
        "id": 2,
        "title": "Java8",
        "slug": "/java/java8",
        "level": 1
      }
    ]
  }
}
```

---

#### 2.3 创建孙子文章

**操作：**
1. 新建文章：
   - 标题：`容器`
   - URL别名：`container`
   - 父文章：选择"Java8"
   - 内容：`# 容器框架`
2. 发布

**预期结果：**
- 文章树出现三级结构：
  ```
  Java
  └── Java8
      └── 容器
  ```

---

#### 2.4 创建曾孙文章

**操作：**
1. 新建文章：
   - 标题：`Map`
   - URL别名：`map`
   - 父文章：选择"容器"
   - 内容：`# Map接口`
2. 发布

**预期结果：**
- 文章树出现四级结构：
  ```
  Java
  └── Java8
      └── 容器
          └── Map
  ```

**验证URL路径：**
- Java文章：http://localhost:5173/post/java
- Java8文章：http://localhost:5173/post/java/java8
- 容器文章：http://localhost:5173/post/java/java8/container
- Map文章：http://localhost:5173/post/java/java8/container/map

---

#### 2.5 测试文章编辑

**操作：**
1. 访问任意文章详情页
2. 点击"编辑"按钮
3. 修改文章内容
4. 点击"保存"

**预期结果：**
- 文章更新成功
- 内容更新显示
- 左侧文章树保持不变

**后端验证：**
```bash
curl -X PUT http://localhost:60000/api/posts/java \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE=" \
  -d '{"title": "Java基础（更新版）"}'
```

---

#### 2.6 测试文章删除

**操作：**
1. 访问任意文章详情页
2. 点击"删除"按钮
3. 确认删除

**预期结果：**
- 文章删除成功
- 跳转到首页
- 左侧文章树移除该节点

**特别注意：**
- 删除父文章时，子文章会变成根文章
- 建议先测试删除叶子节点文章

**后端验证：**
```bash
curl -X DELETE http://localhost:60000/api/posts/java/java8/container/map \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE="
```

---

### 第3步: 测试Markdown编辑器

#### 3.1 测试基础功能

**操作：**
1. 新建或编辑文章
2. 测试以下功能：
   - 粗体：`**文本**`
   - 斜体：`*文本*`
   - 标题：`# 一级标题`
   - 列表：`- 列表项`
   - 代码块：```code```
   - 链接：`[文本](url)`

**预期结果：**
- 实时预览正常显示
- 工具栏按钮工作正常
- 语法高亮正确

---

#### 3.2 测试图片上传

**操作：**
1. 在编辑器中点击图片上传按钮
2. 选择一张本地图片（PNG/JPG，小于10MB）
3. 等待上传

**预期结果：**
- 图片上传成功
- 编辑器中插入Markdown图片语法：`![alt](url)`
- 预览显示图片

**后端验证：**
```bash
# 查看图片目录
ls /home/lizy/projects/DouBlog/backend/data/images/

# 查看数据库中的图片记录
sqlite3 /home/lizy/projects/DouBlog/backend/data/blog.db \
  "SELECT * FROM images;"
```

**访问图片：**
- 浏览器访问返回的图片URL
- 应该正常显示图片

---

#### 3.3 测试图片在文章中的显示

**操作：**
1. 发布包含图片的文章
2. 访问文章详情页

**预期结果：**
- 文章内容正常渲染
- 图片正常显示
- 图片可点击放大（如果支持）

---

### 第4步: 测试主题切换

#### 4.1 测试暗色/亮色模式

**操作：**
1. 点击右上角主题切换按钮
2. 观察页面变化

**预期结果：**
- 暗色模式：深色背景，浅色文字，VS Code Dark风格
- 亮色模式：浅色背景，深色文字
- 刷新页面后，主题保持不变

**验证：**
- 检查HTML标签是否有`class="dark"`
- 检查localStorage中的`theme`值
- 检查CSS变量是否正确应用

---

### 第5步: 测试树形导航

#### 5.1 测试展开/折叠

**操作：**
1. 观察左侧文章树
2. 点击父文章节点前的箭头图标

**预期结果：**
- 点击箭头，子节点展开/折叠
- 点击文章标题，跳转到文章详情
- 当前访问的文章高亮显示

---

#### 5.2 测试导航

**操作：**
1. 点击文章树中的任意文章
2. 观察URL变化和内容更新

**预期结果：**
- URL变为对应文章的路径
- 右侧显示文章内容
- 左侧当前文章节点高亮

---

### 第6步: 测试登出功能

**操作：**
1. 点击右上角用户信息或登出按钮
2. 点击"登出"

**预期结果：**
- 清除认证信息
- 跳转到登录页
- 无法直接访问需要认证的页面

**后端验证：**
```bash
# 登出后尝试访问需要认证的API
curl http://localhost:60000/api/posts \
  -H "Authorization: Basic invalid_token"
```

**预期返回：**
```json
{
  "success": false,
  "code": 401,
  "message": "认证失败",
  "data": null
}
```

---

## 🧪 完整功能测试清单

### 认证功能

- [ ] 登录成功跳转首页
- [ ] 登录失败显示错误提示
- [ ] 未登录自动跳转登录页
- [ ] 登出成功跳转登录页
- [ ] 登出后无法访问受保护页面

### 文章管理

- [ ] 创建根文章成功
- [ ] 创建子文章成功
- [ ] 创建孙子文章成功
- [ ] 创建曾孙文章成功
- [ ] 文章标题和slug必填验证
- [ ] slug唯一性验证
- [ ] 编辑文章成功
- [ ] 删除叶子文章成功
- [ ] 删除父文章，子文章变为根文章
- [ ] 文章详情页正常显示
- [ ] 文章树结构正确
- [ ] 文章树展开/折叠正常
- [ ] 文章树点击导航正常

### Markdown编辑

- [ ] Markdown基础语法渲染正确
- [ ] 图片上传成功
- [ ] 图片在文章中显示正常
- [ ] 实时预览工作正常
- [ ] 工具栏按钮功能正常

### 主题切换

- [ ] 暗色模式显示正确
- [ ] 亮色模式显示正确
- [ ] 主题切换流畅
- [ ] 主题状态持久化

### 用户体验

- [ ] 页面加载速度正常
- [ ] 无JavaScript错误
- [ ] 无CSS样式错误
- [ ] 响应式布局正常（可选）
- [ ] 滚动条样式正确

---

## 🐛 常见问题排查

### 问题1: 跨域错误

**错误信息：**
```
Access to XMLHttpRequest at 'http://localhost:60000/api/...' from origin 'http://localhost:5173' has been blocked by CORS policy
```

**解决方案：**
- 检查后端`app/main.py`中的CORS配置
- 确认`cors_origins`设置正确
- 确认前端API请求使用相对路径`/api`（通过Vite代理）

---

### 问题2: 认证失败

**错误信息：**
```
401 Unauthorized
```

**排查步骤：**
1. 检查localStorage中是否有`auth`字段
2. 检查`auth`字段的值是否正确（Base64编码的`username:password`）
3. 检查请求Header是否包含`Authorization: Basic ...`
4. 检查后端`config.py`中的`auth_username`和`auth_password`

**验证：**
```javascript
// 在浏览器控制台执行
console.log(localStorage.getItem('auth'))
// 应该输出：YWRtaW46bGl6eTExMUE=
```

---

### 问题3: 图片上传失败

**错误信息：**
```
400 Bad Request: 不支持的文件格式
```

**排查步骤：**
1. 确认文件格式是PNG/JPG/JPEG/GIF/WEBP
2. 确认文件大小小于10MB
3. 检查后端`data/images`目录权限
4. 检查后端日志

**检查目录权限：**
```bash
ls -la /home/lizy/projects/DouBlog/backend/data/
```

---

### 问题4: 文章树不显示

**排查步骤：**
1. 打开浏览器控制台，检查是否有错误
2. 检查Network面板，`/api/posts/tree`请求是否成功
3. 检查返回数据格式是否正确
4. 检查前端PostTree组件是否正确渲染

**手动测试API：**
```bash
curl http://localhost:60000/api/posts/tree
```

---

### 问题5: 主题切换不生效

**排查步骤：**
1. 检查HTML标签是否有`class="dark"`
2. 检查CSS变量是否定义
3. 检查Tailwind配置`darkMode: 'class'`
4. 检查localStorage中的`theme`值

**手动验证：**
```javascript
// 在浏览器控制台执行
document.documentElement.classList.add('dark')  // 应该切换到暗色模式
document.documentElement.classList.remove('dark')  // 应该切换到亮色模式
```

---

## 📊 性能测试

### 1. API响应时间测试

```bash
# 测试登录API
curl -w "Time: %{time_total}s\n" -X POST http://localhost:60000/api/auth/login \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE="

# 测试文章树API
curl -w "Time: %{time_total}s\n" http://localhost:60000/api/posts/tree
```

**预期响应时间：** < 100ms

---

### 2. 前端加载时间测试

**操作：**
1. 打开浏览器开发者工具
2. 切换到Network面板
3. 刷新页面
4. 查看DOMContentLoaded和Load时间

**预期加载时间：**
- DOMContentLoaded: < 500ms
- Load: < 1s

---

## 📝 联调报告模板

完成联调后，请填写以下报告：

### 联调结果

**测试时间：** 2026-04-06  
**测试人员：** [AI大模型]  
**测试环境：**
- 前端：Vue 3 + Vite (localhost:5173)
- 后端：Flask (localhost:60000)

### 功能测试结果

| 功能模块 | 测试项 | 结果 | 备注 |
|---|---|---|---|
| 认证 | 登录 | ✅/❌ | |
| 认证 | 登出 | ✅/❌ | |
| 认证 | 拦截 | ✅/❌ | |
| 文章 | 创建 | ✅/❌ | |
| 文章 | 编辑 | ✅/❌ | |
| 文章 | 删除 | ✅/❌ | |
| 文章 | 树形导航 | ✅/❌ | |
| Markdown | 编辑器 | ✅/❌ | |
| Markdown | 图片上传 | ✅/❌ | |
| 主题 | 切换 | ✅/❌ | |

### 问题列表

| 问题编号 | 问题描述 | 严重程度 | 状态 |
|---|---|---|---|
| 1 | | 高/中/低 | 待修复/已修复 |
| 2 | | | |

### 建议

1.
2.
3.

---

## ✅ 联调完成标准

满足以下所有条件，联调完成：

- [ ] 所有核心功能测试通过
- [ ] 无阻塞性Bug
- [ ] API响应时间符合预期
- [ ] 前端加载时间符合预期
- [ ] 无跨域错误
- [ ] 无认证错误
- [ ] 数据格式正确
- [ ] 用户体验良好

---

## 🚀 下一步

联调完成后，可以进行以下优化：

1. **性能优化**
   - 图片懒加载
   - 代码分割
   - 缓存优化

2. **功能增强**
   - 文章搜索
   - 文章导出
   - 访问统计

3. **用户体验优化**
   - 加载动画
   - 错误提示优化
   - 快捷键支持

4. **代码优化**
   - 单元测试补充
   - 代码重构
   - 文档完善

---

**联调文档结束**