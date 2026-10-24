import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright')
const base = process.env.OPTIMIZATION_QA_BASE || 'http://127.0.0.1:60111'
assert.equal(new URL(base).hostname, '127.0.0.1')
const output = path.resolve('../.ui-qa/optimization/frontend-shots')
await fs.mkdir(output,{recursive:true})
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH})
const context = await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']})
const page = await context.newPage(), checks=[], errors=[], blocked=[]
page.setDefaultTimeout(20000)
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  if (url.protocol==='data:' || url.protocol==='blob:' || (url.hostname==='127.0.0.1' && ['60111','60113','60115'].includes(url.port))) return route.continue()
  blocked.push(`${url.origin}${url.pathname}`);return route.abort()
})
const mark=name=>{checks.push(name);console.log('PASS',name)}
const api=async(method,url,data)=>{
  const response=await context.request.fetch(base+url,{method,data}),body=await response.json()
  assert.ok(response.ok(),`${method} ${url}: ${JSON.stringify(body)}`);return body.data
}
const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:false})
async function theme(dark){await page.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('doublog_dark',String(dark))},dark);await page.waitForTimeout(120)}
try {
  await page.goto(base+'/login')
  assert.equal(await page.evaluate(async()=> (await import('/src/shared/client.js')).API_BASE),'','QA must use isolated relative proxy')
  await page.getByPlaceholder('用户名',{exact:true}).fill(process.env.OPTIMIZATION_QA_USERNAME || 'mindmap-qa')
  await page.getByPlaceholder('密码',{exact:true}).fill(process.env.OPTIMIZATION_QA_PASSWORD || 'qa-only-isolated-db')
  await page.getByRole('button',{name:'登 录'}).click();await page.waitForURL(base+'/')
  const status=await api('GET','/api/admin/database');assert.match(status.data_dir,/\.ui-qa[\\/]optimization[\\/]browser-db-3/)
  mark('guard: browser API_BASE and authenticated database both point at isolated QA')

  await page.getByRole('button',{name:'新建分组',exact:false}).click()
  await page.getByRole('heading',{name:'新分组',exact:true}).dblclick()
  await page.getByLabel('分组名称').fill('QA 工作台');await page.getByLabel('分组名称').press('Enter')
  await page.getByRole('status').filter({hasText:'布局已保存'}).waitFor()
  const layout=await api('GET','/api/home/layout');assert.ok(layout.groups.some(group=>group.name==='QA 工作台'));assert.ok(layout.revision>0)
  mark('portal: edits persist through the versioned single writer')
  await theme(false);await shot('portal-light');await theme(true);await shot('portal-dark')
  await page.getByLabel('恢复默认布局').click();await page.getByRole('status').filter({hasText:'布局已保存'}).waitFor()
  assert.equal((await api('GET','/api/home/layout')).groups.length,0)
  await page.waitForTimeout(1000);assert.equal((await api('GET','/api/home/layout')).groups.length,0)
  mark('portal: reset forms a barrier and queued layout does not reappear')

  await page.goto(base+'/missing-page-for-qa');await page.getByRole('heading',{name:'页面不存在'}).waitFor();await shot('404-dark');mark('unknown routes render a usable 404')
  await page.goto(base+'/config');await page.getByRole('heading',{name:'数据库',exact:true}).waitFor();await theme(false);await shot('config-light');await theme(true);await shot('config-dark');mark('configuration renders with database readiness information')

  for (const tool of ['json-format','json-diff','text-diff','regex','json-csv','json-escape','json-to-code','text-stats','text-lines','base64','unicode']) {
    await page.goto(base+'/devtoolbox?t='+tool)
    await page.locator('.cm-editor').first().waitFor();await page.waitForTimeout(550)
    assert.ok(await page.locator('.cm-content[contenteditable="true"]').count()>0,tool)
    await theme(false);await shot(tool+'-light');await theme(true);await shot(tool+'-dark')
    mark('tool: '+tool+' real CodeMirror/Worker initial calculation and themes')
  }
  await page.goto(base+'/devtoolbox?t=regex');await page.getByLabel('正则表达式',{exact:true}).fill('(a+)+$')
  const regexInput=page.getByLabel('测试文本',{exact:true});await regexInput.fill('a'.repeat(32)+'!')
  await page.getByText('计算超时，请缩小输入或调整表达式',{exact:false}).waitFor()
  await page.getByLabel('正则表达式',{exact:true}).fill('a+');await page.getByText('匹配 1 处',{exact:false}).waitFor()
  mark('regex: catastrophic backtracking times out in Worker, next valid request succeeds')

  await page.goto(base+'/tools/optimization-frontend.html')
  const editor=page.getByLabel('QA editor',{exact:true});await editor.waitFor();await editor.fill('中文😀 new input');await editor.press('Control+s')
  assert.equal(await page.locator('[data-saved]').innerText(),'1');assert.equal(await page.locator('[data-value]').innerText(),'中文😀 new input')
  await editor.press('Control+z');assert.notEqual(await page.locator('[data-value]').innerText(),'中文😀 new input')
  await page.getByRole('button',{name:'只读切换'}).click();assert.equal(await page.locator('.cm-content').getAttribute('contenteditable'),'false')
  const virtual=page.locator('[data-virtual-total="10000"]');assert.ok(await virtual.locator('[data-index]').count()<100)
  await virtual.locator('..').evaluate(element=>{element.scrollTop=element.scrollHeight});await page.locator('[data-row="9999"]').waitFor()
  await page.getByRole('button',{name:'轮询切换'}).click();await page.waitForTimeout(530);await page.getByRole('button',{name:'轮询切换'}).click()
  const polling=await page.evaluate(()=>window.pollMetrics);assert.equal(polling.max,1);assert.ok(polling.cancelled>=1)
  const worker=await page.evaluate(async()=>{
    try {await window.frontendChecks.tasks.run('regex',{pattern:'(a+)+$',flags:'g',text:'a'.repeat(32)+'!'},{timeoutMs:250});return 'failed'}catch(error){return error.name}
  });assert.equal(worker,'TimeoutError')
  mark('shared: editor change/save/undo/read-only; 10000 variable-height rows reach last item; polling single flight/abort; Worker termination')

  await page.goto(base+'/vault');await page.waitForTimeout(500)
  if (await page.getByPlaceholder('主密码（≥8 位）').count()) {
    await page.getByPlaceholder('主密码（≥8 位）').fill('QA-vault-password-only');await page.getByPlaceholder('再输入一次').fill('QA-vault-password-only')
    await page.getByRole('button',{name:'创建密码库',exact:true}).click();await page.getByText('保存你的恢复密钥',{exact:true}).waitFor()
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'已保存，进入解锁'}).click()
  }
  await page.getByPlaceholder('输入主密码…').fill('QA-vault-password-only');await page.getByRole('button',{name:'解锁保险库',exact:true}).click();await page.getByRole('button',{name:'锁定',exact:true}).waitFor()
  const existing=await api('GET','/api/vault/items?trash=0')
  if(existing.items.length<250){
    const account=await api('GET','/api/vault/account')
    const payloads=await page.evaluate(async({account,start})=>{
      const {unlockVault,encryptBlob}=await import('/src/vault/components/crypto.js'),{emptyItem}=await import('/src/vault/components/core.js')
      const key=await unlockVault(account,'QA-vault-password-only'),out=[]
      for(let i=start;i<250;i++){const record={...emptyItem(),service:`QA 密码条目 ${String(i).padStart(3,'0')}`,username:`qa-user-${i}`,urls:[{value:`https://qa-${i}.invalid`}],password:{value:'QA-fixture-only'}};out.push({blob:await encryptBlob(key,record)})}
      return out
    },{account,start:existing.items.length})
    for(let offset=0;offset<payloads.length;offset+=8)await Promise.all(payloads.slice(offset,offset+8).map(payload=>api('POST','/api/vault/items',payload)))
    await page.reload();await page.getByPlaceholder('输入主密码…').fill('QA-vault-password-only');await page.getByRole('button',{name:'解锁保险库',exact:true}).click();await page.getByRole('button',{name:'锁定',exact:true}).waitFor()
  }
  await page.getByRole('button',{name:'全部条目',exact:false}).first().click()
  await page.locator('[data-virtual-total="250"]').waitFor()
  assert.ok(await page.locator('[data-virtual-total="250"] [data-index]').count()<100)
  assert.equal(blocked.some(url=>url.includes('duckduckgo.com')),false,'external icons must remain opt-in')
  await theme(false);await shot('vault-light');await theme(true);await shot('vault-dark')
  await page.locator('[data-virtual-total="250"]').locator('..').evaluate(element=>{element.scrollTop=element.scrollHeight})
  await page.getByText('QA 密码条目 000',{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'锁定',exact:true}).click();await page.getByText('密码库已锁定',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-virtual-total]').count(),0)
  const storage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));assert.equal(storage['doublog.hibp.v1'],undefined);assert.ok(!JSON.stringify(storage).includes('QA-vault-password-only'))
  mark('vault: real Argon2 Worker setup/unlock and lock clears detail/list; no password or HIBP hash persisted')
  let release, started=false
  const hold=new Promise(resolve=>{release=resolve})
  const holdItems=async route=>{started=true;const response=await route.fetch();await hold;await route.fulfill({response}).catch(()=>{})}
  await page.route('**/api/vault/items?trash=0',holdItems)
  await page.getByPlaceholder('输入主密码…').fill('QA-vault-password-only');await page.getByRole('button',{name:'解锁保险库',exact:true}).click();await page.getByRole('button',{name:'锁定',exact:true}).waitFor()
  await page.waitForFunction(()=>document.body.textContent.includes('锁定'))
  await page.getByRole('button',{name:'锁定',exact:true}).click();release();await page.waitForTimeout(400);await page.unroute('**/api/vault/items?trash=0',holdItems)
  assert.equal(started,true);assert.equal(await page.locator('[data-virtual-total]').count(),0);assert.equal(await page.getByText('QA 密码条目 249',{exact:true}).count(),0)
  mark('vault: lock during an in-flight item response rejects all late plaintext publication')

  await page.goto(base+'/gamemap/games/1/chapters/1');await page.locator('.gm8-node').first().waitFor();await page.waitForTimeout(600)
  assert.ok(await page.locator('.gm8-edge-g').count()>0)
  const beforeBoard=await api('GET','/api/gamemap/games/1/boards/chapters/1')
  // Choose the leftmost node and move outward, avoiding anti-overlap snapping
  // back to its original position after earlier fault scenarios move fixtures.
  const nodeId=[...beforeBoard.nodes].sort((a,b)=>a.x-b.x||a.y-b.y)[0].character_id,node=page.locator(`.react-flow__node[data-id="c-${nodeId}"]`),box=await node.boundingBox();assert.ok(box)
  const savedResponse=page.waitForResponse(response=>response.url().includes('/boards/positions/batch')&&response.request().method()==='POST'&&response.status()===200)
  await page.mouse.move(box.x+box.width/2,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width/2-45,box.y+10,{steps:15});await page.mouse.up();await page.waitForTimeout(900)
  await savedResponse
  const afterBoard=await api('GET','/api/gamemap/games/1/boards/chapters/1'),beforeNode=beforeBoard.nodes.find(node=>node.character_id===nodeId),afterNode=afterBoard.nodes.find(node=>node.character_id===nodeId)
  assert.ok(Math.abs(beforeNode.x-afterNode.x)+Math.abs(beforeNode.y-afterNode.y)>10);assert.ok(afterBoard.version>beforeBoard.version)
  await theme(false);await shot('gamemap-light');await theme(true);await shot('gamemap-dark')
  assert.equal(await page.getByText('保存失败：',{exact:false}).count(),0)
  mark('gamemap: real rendered nodes and custom edges follow mouse drag and versioned batch save')
  assert.deepEqual(errors,[])
  mark('no uncaught browser errors')
} finally {
  await fs.writeFile(path.resolve('../.ui-qa/optimization/frontend-results.json'),JSON.stringify({checks,errors,blocked,finishedAt:new Date().toISOString()},null,2))
  await browser.close()
}
