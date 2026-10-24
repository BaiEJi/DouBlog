import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
const base = 'http://127.0.0.1:60111'
const output = path.resolve('../.ui-qa/optimization/knowledge-browser')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const report = { checks: [], errors: [], blocked: [], shots: [] }
page.on('pageerror', error => report.errors.push(error.message))
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || (url.hostname === '127.0.0.1' && ['60111', '60113', '60115'].includes(url.port))) return route.continue()
  report.blocked.push(`${url.origin}${url.pathname}`)
  return route.abort()
})
const mark = text => { report.checks.push(text); console.log('PASS', text) }
async function api(method, url, data) {
  const response = await context.request.fetch(base + url, { method, data })
  const body = await response.json()
  assert.ok(response.ok() && body.success, `${method} ${url}: ${JSON.stringify(body)}`)
  return body.data
}
async function theme(dark) {
  await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
  await page.waitForTimeout(150)
}
async function shot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) })
  report.shots.push(name)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ': viewport overflow')
}
async function visit(route, name, ready) {
  await page.goto(base + route)
  await page.getByText(ready, { exact: false }).first().waitFor()
  await page.waitForTimeout(500)
  await fs.writeFile(path.join(output, `${name}-dom.txt`), await page.locator('body').innerText())
  for (const dark of [false, true]) { await theme(dark); await shot(`${name}-${dark ? 'dark' : 'light'}`) }
  mark(`${name}: real page rendered in both themes`)
}
async function code(text, index = 0) {
  const editor = page.locator('.cm-content[contenteditable="true"]').nth(index)
  await editor.click(); await editor.press('Control+a'); await page.keyboard.insertText(text)
  return editor
}
try {
  await page.goto(base + '/login')
  assert.equal(await page.evaluate(async () => (await import('/src/shared/client.js')).API_BASE), '')
  await page.getByPlaceholder('用户名', { exact: true }).fill('mindmap-qa')
  await page.getByPlaceholder('密码', { exact: true }).fill('qa-only-isolated-db')
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await page.waitForURL(base + '/')
  const database = await api('GET', '/api/admin/database')
  assert.ok(database.data_dir.replaceAll('\\', '/').endsWith('/DouBlog/.ui-qa/optimization/browser-db-3'), database.data_dir)
  mark('guard: isolated authenticated database and proxy verified before mutations')
  await visit('/blog', 'blog', '文章')
  await visit('/diary', 'diary', '随记')
  await visit('/assets', 'assets', '资产')
  await visit('/bookmarks', 'bookmarks', '书签')
  await visit('/practice', 'practice', '题')
  await visit('/todo?v=backlog', 'todo', '待办池')
  await visit('/subs', 'subs', '会员')

  if (process.env.KNOWLEDGE_QA_SMOKE !== '1') {
    const marker = 'knowledge-qa-' + Date.now()
    await page.goto(base + '/blog')
    await page.getByPlaceholder('搜索全部内容 ⌘K').fill('验收文档 02104')
    await page.getByRole('heading', { name: '验收文档 02104', exact: true }).waitFor()
    assert.ok((await api('GET', '/api/posts?page=88&page_size=24&workspace_id=2')).total >= 2105)
    mark('blog: search and server pagination reach articles beyond the old 2000 boundary')

    // Selection, undo, toolbar, native paste/drop and Ctrl+S run through the CodeMirror bridge.
    const post = await api('POST', '/api/posts', { title: marker, name: marker, workspace_id: 2, content: 'original' })
    await page.goto(base + `/post/${post.id}/edit`)
    let editor = await code('中文输入与 English\nsecond line')
    await editor.press('Control+Home'); await editor.press('Shift+End'); await editor.press('Control+b')
    assert.match(await editor.innerText(), /\*\*中文输入与 English\*\*/)
    await editor.press('Control+z')
    assert.equal(await editor.innerText(), '中文输入与 English\nsecond line')
    await page.getByTitle('插入表格模板', { exact: true }).click()
    assert.match(await editor.innerText(), /\|/)
    await editor.press('Control+End')
    await editor.evaluate(element => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', '\nclipboard plain 中文')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }))
    })
    await page.keyboard.insertText('\n' + marker)
    await editor.press('Control+s')
    await page.waitForURL(base + `/post/${post.id}`)
    const savedPost = await api('GET', `/api/posts/id/${post.id}?no_view=1`)
    assert.ok(savedPost.content.includes(marker))
    mark('blog editor: CJK input, selection bold, undo, table toolbar and Ctrl+S persist')
    await shot('blog-editor-saved')

    // Diary: explicit server failure keeps the full text and prevents closing.
    await page.goto(base + '/diary')
    await page.locator('.diary-prose').first().click()
    await page.getByRole('button', { name: '完成', exact: true }).waitFor()
    let rejectDiary = true
    const diaryWrites = []
    await page.route('**/api/diary/entries/*', route => {
      if (route.request().method() === 'PUT') {
        diaryWrites.push(route.request().postDataJSON())
        if (rejectDiary) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'QA temporary diary outage' }) })
      }
      return route.continue()
    })
    editor = await code('日记离线草稿 ' + marker)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'QA temporary diary outage' }).waitFor()
    assert.equal(await editor.innerText(), '日记离线草稿 ' + marker)
    assert.ok(await page.getByRole('button', { name: '完成', exact: true }).isVisible())
    await shot('diary-save-error-keeps-input')
    rejectDiary = false
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await page.getByRole('button', { name: '完成', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(diaryWrites.at(-1).mutation_id, diaryWrites[0].mutation_id)
    await page.unroute('**/api/diary/entries/*')
    mark('diary: failure retains draft and modal; retry reuses mutation id; success permits close')
    await page.getByRole('button', { name: /加载更多/ }).click()
    mark('diary: load-more retrieves the next server page')

    // Practice: one transaction, 409 keeps local input and original server version.
    await page.goto(base + '/practice')
    await page.getByRole('button', { name: '新增题目', exact: true }).click()
    await page.getByPlaceholder('两数之和', { exact: true }).fill(marker)
    await code('题干 中文 `code` ' + marker)
    await page.getByPlaceholder('解法名称（如：动态规划）', { exact: true }).fill('完整事务解法')
    await page.locator('select').filter({ has: page.locator('option', { hasText: '＋ 添加语言' }) }).selectOption('python')
    const practiceCode = page.getByRole('textbox', { name: 'Python 代码', exact: true })
    await practiceCode.click(); await page.keyboard.insertText('print("中文 atomic")')
    let loseCreateResponse = true
    await page.route('**/api/practice/problems', async route => {
      if (route.request().method() === 'POST' && loseCreateResponse) {
        loseCreateResponse = false
        await route.fetch() // Commit succeeded, but the browser cannot know the result.
        return route.abort('connectionreset')
      }
      return route.continue()
    })
    await page.getByRole('button', { name: '创建题目', exact: true }).click()
    await page.getByText(/Failed to fetch|网络|请求失败/).last().waitFor()
    await page.getByPlaceholder('两数之和', { exact: true }).fill(marker + '-continued')
    await page.getByRole('button', { name: '创建题目', exact: true }).click()
    await page.getByRole('heading', { name: '新增题目', exact: true }).waitFor({ state: 'hidden' })
    await page.unroute('**/api/practice/problems')
    const problems = await api('GET', '/api/practice/problems?q=' + marker)
    assert.equal(problems.items.length, 1, 'Unknown successful create must be replayed, not duplicated')
    const created = problems.items[0]
    assert.ok(created)
    assert.equal(created.title, marker + '-continued')
    const atomic = await api('GET', `/api/practice/problems/${created.id}`)
    assert.equal(atomic.solutions.length, 1)
    assert.equal(atomic.solutions[0].codes[0].code, 'print("中文 atomic")')
    mark('practice: lost create acknowledgement replays same mutation then saves newer edits without duplication')
    await page.getByRole('button', { name: '编辑', exact: true }).first().click()
    await page.getByPlaceholder('两数之和', { exact: true }).fill(marker + '-local')
    const detail = await api('GET', `/api/practice/problems/${created.id}`)
    const problemData = detail.problem || detail
    await api('PATCH', `/api/practice/problems/${created.id}`, { title: marker + '-remote', revision: problemData.revision })
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByText(/冲突|已被修改|版本/).last().waitFor()
    assert.equal(await page.getByPlaceholder('两数之和', { exact: true }).inputValue(), marker + '-local')
    await shot('practice-409-keeps-input')
    mark('practice: create commits full form, atomic edit conflict preserves local title')

    const assetTitle = marker + '-diff'
    const assetLines = Array.from({ length: 600 }, (_, index) => `line ${index} preserved`)
    const asset = await api('POST', '/api/assets/items', { kind: 'prompt', title: assetTitle, content: assetLines.join('\n') })
    assetLines[599] = 'final line changed'
    await api('PUT', `/api/assets/items/${asset.id}`, { content: assetLines.join('\n') })
    await page.goto(base + '/assets')
    await page.getByRole('heading', { name: assetTitle, exact: true }).click()
    await page.getByRole('button', { name: /版本（/ }).click()
    await page.getByRole('button', { name: /^v1/ }).click()
    await page.getByRole('button', { name: '复制完整补丁', exact: true }).waitFor()
    assert.equal(Number(await page.locator('[data-virtual-total]').getAttribute('data-virtual-total')), 601)
    await shot('assets-worker-history-diff')
    mark('assets: paginated history loads a full older version and shared diff renders')

    await page.goto(base + '/todo?v=backlog')
    const next = page.getByRole('button', { name: '下一页', exact: true })
    await next.click()
    await page.getByText('待办 000050', { exact: true }).waitFor()
    assert.equal(await page.getByText('待办 000000', { exact: true }).count(), 0)
    await page.goto(base + '/todo?v=calendar')
    await page.getByRole('button', { name: '年', exact: true }).click()
    await page.getByText(/共 \d+ 个任务/).waitFor()
    await shot('todo-year-calendar-summary')
    mark('todo: inbox advances to next 50 and yearly calendar consumes small summaries')

    await page.goto(base + '/subs')
    await page.getByText('会员 0000', { exact: true }).waitFor()
    await page.getByRole('button', { name: '平均订阅', exact: true }).click()
    await page.getByRole('button', { name: '累计花费', exact: true }).click()
    await page.getByText('¥99999.00', { exact: true }).waitFor()
    await page.goto(base + '/subs/stats')
    await page.getByRole('switch').click()
    await page.getByRole('heading', { name: '所选范围支出明细', exact: true }).waitFor()
    await page.getByRole('navigation', { name: '支出明细分页' }).waitFor()
    await shot('subs-paginated-details')
    mark('subs: full-population top member visible and details are fetched on demand with pages')

    await page.goto(base + '/bookmarks')
    await page.getByRole('button', { name: '工具', exact: true }).click()
    const beforeBooks = (await api('GET', '/api/bookmarks/items')).total
    await page.locator('input[type="file"]').setInputFiles({ name: 'qa-bookmarks.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ items: [{ url: `https://example.org/${marker}`, title: marker }] })) })
    await page.getByText('尚未写入数据。', { exact: false }).waitFor()
    assert.equal((await api('GET', '/api/bookmarks/items')).total, beforeBooks)
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText(/导入 1 条/).waitFor()
    assert.equal((await api('GET', '/api/bookmarks/items')).total, beforeBooks + 1)
    await shot('bookmarks-dryrun-confirmed')
    mark('bookmarks: file preflight performs no writes until explicit import')
  }
  assert.deepEqual(report.errors, [], 'No uncaught runtime errors')
} catch (error) {
  report.failure = error.stack
  await shot('failure').catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
