import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright')
const base=process.env.OPTIMIZATION_QA_BASE||'http://127.0.0.1:60111'
assert.equal(new URL(base).hostname,'127.0.0.1')
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH}),context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true})
const page=await context.newPage(),checks=[],errors=[],blocked=[],shots=path.resolve('../.ui-qa/optimization/frontend-fault-shots')
let failure
await fs.mkdir(shots,{recursive:true});page.setDefaultTimeout(20000)
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{const u=new URL(route.request().url());if(['blob:','data:'].includes(u.protocol)||(u.hostname==='127.0.0.1'&&['60111','60113','60115'].includes(u.port)))return route.continue();blocked.push(u.origin+u.pathname);return route.abort()})
const mark=name=>{checks.push(name);console.log('PASS',name)}
const api=async(method,url,data)=>{const r=await context.request.fetch(base+url,{method,data}),body=await r.json();assert.ok(r.ok(),JSON.stringify(body));return body.data}
const saved=()=>page.getByRole('status').filter({hasText:'布局已保存'}).waitFor()
const shot=async name=>{if(/-(dark|light)$/.test(name)){const dark=name.endsWith('-dark');await page.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('doublog_dark',String(dark))},dark);await page.waitForTimeout(150)}return page.screenshot({path:path.join(shots,name+'.png')})}
async function unlock(){await page.goto(base+'/vault');await page.getByPlaceholder('输入主密码…').fill('QA-vault-password-only');await page.getByRole('button',{name:'解锁保险库',exact:true}).click();await page.getByRole('button',{name:'锁定',exact:true}).waitFor()}
try{
 await page.goto(base+'/login');assert.equal(await page.evaluate(async()=>(await import('/src/shared/client.js')).API_BASE),'')
 await page.getByPlaceholder('用户名',{exact:true}).fill('mindmap-qa');await page.getByPlaceholder('密码',{exact:true}).fill('qa-only-isolated-db');await page.getByRole('button',{name:'登 录'}).click();await page.waitForURL(base+'/')
 const database=await api('GET','/api/admin/database');assert.match(database.data_dir,/\.ui-qa[\\/]optimization[\\/]browser-db-3/)
 mark('guard: relative API proxy and isolated authenticated database asserted before mutations')
 await saved()
 // Vite's HMR graph may pin a timestamped singleton URL after source edits.
 // Import the actual application's module, rather than creating a second
 // unversioned copy of the in-memory session in a test evaluate() call.
 const dataModule=await page.evaluate(()=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/shared/dataEpoch.js')?.name||'/src/shared/dataEpoch.js')

 if(!process.argv.includes('--gamemap-only')){

 // Commit a layout but discard its first response. Both HTTP attempts must use
 // exactly the same mutation ID, payload and revision, producing one commit.
 const before=await api('GET','/api/home/layout'),writes=[]
 let drop=true
 const loseResponse=async route=>{if(route.request().method()!=='PUT')return route.continue();writes.push(JSON.parse(route.request().postData()));const response=await route.fetch();if(drop){drop=false;return route.abort('failed')}return route.fulfill({response})}
 await page.route('**/api/home/layout',loseResponse)
 await page.getByRole('button',{name:'新建分组',exact:false}).click();await saved();await page.unroute('**/api/home/layout',loseResponse)
 assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal((await api('GET','/api/home/layout')).revision,before.revision+1)
 mark('portal: a committed write with lost response replays the same mutation, committing exactly once')

 let release,started=false;const hold=new Promise(resolve=>{release=resolve}),order=[],max={active:0,value:0}
 const holdSave=async route=>{const method=route.request().method();if(!['PUT','DELETE'].includes(method))return route.continue();max.value=Math.max(max.value,++max.active);order.push(method+' start');if(method==='PUT'&&!started){started=true;await hold}const response=await route.fetch();order.push(method+' done');max.active--;return route.fulfill({response})}
 await page.route('**/api/home/layout',holdSave)
 await page.getByRole('button',{name:'新建分组',exact:false}).click()
 await page.waitForTimeout(900);assert.equal(started,true)
 await page.getByLabel('恢复默认布局').click();await page.getByRole('status').filter({hasText:'正在恢复默认'}).waitFor();assert.equal(order.some(s=>s.startsWith('DELETE')),false)
 release();await saved();await page.unroute('**/api/home/layout',holdSave)
 assert.equal(max.value,1);assert.deepEqual(order,['PUT start','PUT done','DELETE start','DELETE done']);await page.waitForTimeout(1000);assert.equal((await api('GET','/api/home/layout')).groups.length,0)
 mark('portal: reset waits for in-flight save, never overlaps writes and cannot resurrect queued groups')

 // The admin readiness endpoint is mocked; no database configuration is sent
 // to the real backend. It deliberately remains pending beyond the old 3.5s.
 let switched=false,polls=0,confirmed=false,authChecks=0
 const readiness=async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/admin/database/switch'){switched=true;return route.fulfill({json:{success:true,data:{backend:'postgres',restart_required:true}}})}if(!switched)return route.continue();polls++;confirmed=polls>=6;return route.fulfill({json:{success:true,data:{...database,backend:'postgres',running_backend:confirmed?'postgres':'sqlite',pending_restart:!confirmed,identity:confirmed?'qa-mock-other-db':database.identity}}})}
 const trackAuth=async route=>{authChecks++;return route.continue()}
 await page.route('**/api/admin/database{,/**}',readiness);await page.route('**/api/auth/check',trackAuth)
 await page.goto(base+'/config');await page.getByRole('button',{name:'切换到 PostgreSQL'}).click();await page.getByText('等待后端重启生效',{exact:false}).waitFor();await page.waitForTimeout(3600)
 assert.equal(confirmed,false);assert.match(await page.locator('body').innerText(),/等待后端重启生效/)
 await page.waitForFunction(()=>document.body.textContent.includes('PostgreSQL（远端）'),{timeout:10000});assert.ok(polls>=6);assert.ok(authChecks>=2)
 await page.unroute('**/api/admin/database{,/**}',readiness);await page.unroute('**/api/auth/check',trackAuth)
 mark('config: readiness remains pending after 3.5 seconds and only resets context after actual running-backend confirmation (mock only)')

 // 503 must not clear the authenticated cookie or redirect to login.
 const unavailable=route=>route.fulfill({status:503,json:{success:false,message:'temporary'}})
 await page.route('**/api/auth/check',unavailable);await page.goto(base+'/devtoolbox?t=json-format#keep');await page.getByText('暂时无法确认服务状态',{exact:true}).waitFor();assert.ok(!page.url().includes('/login'))
 await page.unroute('**/api/auth/check',unavailable);await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.cm-editor').first().waitFor()
 const unauthorized=route=>route.fulfill({status:401,json:{success:false,message:'expired'}})
 await page.route('**/api/auth/check',unauthorized);await page.goto(base+'/devtoolbox?t=text-diff#preserve');await page.waitForURL(url=>url.pathname==='/login');assert.equal(new URL(page.url()).searchParams.get('next'),'/devtoolbox?t=text-diff#preserve');await page.unroute('**/api/auth/check',unauthorized)
 mark('auth: 503 retains session and retry; only 401 redirects with complete query/hash deep link')

 // The foreign identity is synthetic. No real database switch is performed.
 await page.goto(base+'/devtoolbox?t=json-format');await page.locator('.cm-editor').first().waitFor();const input=page.locator('.cm-content[contenteditable="true"]').first();await input.fill('{"keep":"unsaved 中文😀"}')
 const oldEpoch=await page.evaluate(async url=>(await import(url)).getDataEpoch(),dataModule)
 const mismatch=route=>route.fulfill({status:409,headers:{'Content-Type':'application/json','X-Database-Identity':'qa-foreign-db'},body:JSON.stringify({success:false,data:{error_code:'DATABASE_CHANGED'},message:'changed'})})
 await page.route('**/api/qa-database-boundary',mismatch)
 const first=await page.evaluate(async()=>{try{await(await import('/src/shared/client.js')).apiJson('/api/qa-database-boundary');return null}catch(e){return e.code}});assert.equal(first,'DATABASE_CHANGED')
 await page.getByText('数据库已在其他页面切换。',{exact:false}).waitFor();assert.equal(await input.innerText(),'{"keep":"unsaved 中文😀"}');assert.equal(await page.evaluate(async url=>(await import(url)).getDataEpoch(),dataModule),oldEpoch)
 const subsequent=await page.evaluate(async()=>{try{await(await import('/src/shared/client.js')).apiJson('/api/vault/items',{method:'POST',body:'{}'});return null}catch(e){return e.code}});assert.equal(subsequent,'DATABASE_CHANGED')
 await shot('database-changed-dark');await page.unroute('**/api/qa-database-boundary',mismatch);await page.reload();await page.locator('.cm-editor').first().waitFor()
 mark('database identity: foreign response cannot enter old page; unsaved editor and epoch preserved; subsequent mutation blocked before network')

 await unlock();await page.getByRole('button',{name:'全部条目',exact:false}).first().click();await page.getByTitle('新建',{exact:true}).click();await page.getByPlaceholder('GitHub').fill('QA rejected vault draft')
 let rejected=false
 const rejectVault=route=>{if(route.request().method()!=='POST')return route.continue();rejected=true;return route.fulfill({status:400,json:{success:false,message:'QA rejected ciphertext fixture'}})}
 await page.route('**/api/vault/items',rejectVault);await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'QA rejected ciphertext fixture'}).first().waitFor();assert.equal(rejected,true);assert.equal(await page.getByPlaceholder('GitHub').inputValue(),'QA rejected vault draft')
 await shot('vault-rejected-draft-dark');await page.unroute('**/api/vault/items',rejectVault);await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByText('QA rejected ciphertext fixture',{exact:true}).count(),0)
 mark('vault: server rejection preserves the complete editable input and displays the error')

 // Real isolated password service project, no algorithm changes. Long expiry
 // fixture allows observing that the shared clock does not poll every row.
 let projects=await api('GET','/api/pwsvc/projects'),project=projects.find(p=>p.name==='QA frontend service')
 if(!project)project=await api('POST','/api/pwsvc/projects',{name:'QA frontend service'})
 let types=await api('GET',`/api/pwsvc/projects/${project.id}/types`),type=types[0]
 if(!type)type=await api('POST',`/api/pwsvc/projects/${project.id}/types`,{name:'QA 10 minute policy',rotation_seconds:600})
 let users=await api('GET',`/api/pwsvc/projects/${project.id}/users`)
 if(!users.length){await api('POST',`/api/pwsvc/projects/${project.id}/users`,{username:'qa-frontend-user',type_id:type.id});users=await api('GET',`/api/pwsvc/projects/${project.id}/users`)}
 let currentCalls=0,logCalls=0
 const countService=route=>{const u=new URL(route.request().url());if(/\/users\/\d+\/current$/.test(u.pathname))currentCalls++;if(u.pathname.endsWith('/logs'))logCalls++;return route.continue()}
 await page.route('**/api/pwsvc/**',countService);await page.getByRole('button',{name:'密码服务',exact:true}).click();await page.getByRole('button',{name:new RegExp(project.name)}).click();await page.getByText('qa-frontend-user',{exact:true}).waitFor();await page.waitForTimeout(1200)
 const count=currentCalls;assert.ok(count>0);await page.waitForTimeout(2300);assert.equal(currentCalls,count);assert.equal(logCalls,0)
 await page.getByRole('button',{name:'查询校验日志',exact:true}).click();await page.waitForTimeout(350);assert.equal(logCalls,1);await shot('pwsvc-dark');await page.evaluate(()=>{document.documentElement.classList.remove('dark')});await shot('pwsvc-light');await page.unroute('**/api/pwsvc/**',countService)
 mark('pwsvc: valid passwords avoid per-second backend refetch; logs load only after explicit open; both themes render')
 }

 // Restoring a position draft is explicit, versioned and safe against races.
 const board=await api('GET','/api/gamemap/games/1/boards/chapters/1'),point=board.nodes[0],x=point.x+31,y=point.y+17
 await page.evaluate(async({version,id,x,y,moduleURL})=>{const{getDataIdentity}=await import(moduleURL);localStorage.setItem(`doublog.gamemap.positions:${getDataIdentity()}:1`,JSON.stringify({revision:{1:version},sequence:1,snapshot:{revisions:{1:version},boards:[{chapter_id:1,positions:[{character_id:id,x,y}]}]}}))},{version:board.version,id:point.character_id,x,y,moduleURL:dataModule})
 let positionCalls=0;const countPositions=route=>{positionCalls++;return route.continue()};await page.route('**/api/gamemap/games/1/boards/positions/batch',countPositions)
 await page.goto(base+'/gamemap/games/1/chapters/1');await page.locator('.gm8-node').first().waitFor();await page.getByRole('button',{name:'恢复草稿',exact:true}).waitFor();await page.waitForTimeout(500);assert.equal(positionCalls,0);assert.equal(await page.locator('.react-flow__node.draggable').count(),0)
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载位置',exact:true}).click();assert.match((await download).suggestedFilename(),/positions\.json$/)
 const restored=page.waitForResponse(r=>r.url().includes('/boards/positions/batch')&&r.status()===200);await page.getByRole('button',{name:'恢复草稿',exact:true}).click();await restored
 const after=await api('GET','/api/gamemap/games/1/boards/chapters/1'),moved=after.nodes.find(n=>n.character_id===point.character_id);assert.equal(moved.x,x);assert.equal(moved.y,y);await page.unroute('**/api/gamemap/games/1/boards/positions/batch',countPositions)
 // Hit SVG must be under React Flow's ZoomPane so wheel over an actual edge
 // follows its native zoom handler instead of swallowing the event.
 const edgePoint=await page.evaluate(()=>{for(const e of document.querySelectorAll('.gm8-edge-hit-layer path')){const p=e.getPointAtLength(e.getTotalLength()*.35),matrix=e.getScreenCTM(),s=new DOMPoint(p.x,p.y).matrixTransform(matrix);if(s.x>240&&s.x<1500&&s.y>140&&s.y<850&&document.elementFromPoint(s.x,s.y)===e)return{x:s.x,y:s.y}}return null})
 assert.ok(edgePoint,'a visible edge must receive the wheel event')
 const transform=await page.locator('.react-flow__viewport').getAttribute('style');await page.mouse.move(edgePoint.x,edgePoint.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-160);await page.keyboard.up('Control');await page.waitForTimeout(400);assert.notEqual(await page.locator('.react-flow__viewport').getAttribute('style'),transform)
 await shot('gamemap-restored-light')
 mark('gamemap: draft never auto-writes, downloads complete positions and restores with CAS; wheel over actual edge reaches native zoom')

 await page.evaluate(async({moduleURL,version,id,x,y})=>{const{getDataIdentity}=await import(moduleURL);localStorage.setItem(`doublog.gamemap.positions:${getDataIdentity()}:1`,JSON.stringify({revision:{1:version-1},sequence:1,snapshot:{revisions:{1:version-1},boards:[{chapter_id:1,positions:[{character_id:id,x:x+5,y:y+7}]}]}}))},{moduleURL:dataModule,version:after.version,id:point.character_id,x,y})
 await page.reload();await page.getByRole('button',{name:'恢复草稿',exact:true}).waitFor();let conflicts=0
 const countConflicts=route=>{conflicts++;return route.continue()};await page.route('**/api/gamemap/games/1/boards/positions/batch',countConflicts)
 const conflict=page.waitForResponse(r=>r.url().includes('/boards/positions/batch')&&r.status()===409);await page.getByRole('button',{name:'恢复草稿',exact:true}).click();await conflict;await page.getByText('保存失败：',{exact:false}).waitFor();await page.waitForTimeout(1700);assert.equal(conflicts,1)
 assert.equal((await api('GET','/api/gamemap/games/1/boards/chapters/1')).version,after.version)
 await shot('gamemap-conflict-light');await page.unroute('**/api/gamemap/games/1/boards/positions/batch',countConflicts)
 await page.reload();await page.getByRole('button',{name:'放弃草稿',exact:true}).click();assert.equal(await page.getByRole('button',{name:'恢复草稿',exact:true}).count(),0)
 mark('gamemap: stale draft CAS conflict sends once, keeps server revision unchanged and remains available until explicit discard')

 const candidate=await page.evaluate(()=>{for(const e of document.querySelectorAll('.react-flow__node')){const r=e.getBoundingClientRect();if(r.x>240&&r.x+r.width<1500&&r.y>160&&r.y+r.height<800)return{x:r.x+r.width/2,y:r.y+20}}return null});assert.ok(candidate)
 await page.mouse.click(candidate.x,candidate.y);await page.keyboard.press('Escape');await page.locator('.ant-drawer-mask').waitFor({state:'hidden'});await page.keyboard.press('ArrowRight');await page.getByRole('link',{name:'门户',exact:true}).click();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor()
 const pendingDraft=await page.evaluate(async url=>{const{getDataIdentity}=await import(url);return JSON.parse(localStorage.getItem(`doublog.gamemap.positions:${getDataIdentity()}:1`)||'null')},dataModule)
 assert.ok(pendingDraft?.snapshot?.boards?.some(board=>board.positions.length),'navigation before keyboard debounce must retain final points')
 await page.goto(base+'/gamemap/games/1/chapters/1');await page.getByRole('button',{name:'恢复草稿',exact:true}).waitFor();const restoredAgain=page.waitForResponse(r=>r.url().includes('/boards/positions/batch')&&r.status()===200);await page.getByRole('button',{name:'恢复草稿',exact:true}).click();await restoredAgain
 mark('gamemap: leaving before keyboard save debounce persists the final points and unknown in-flight receipt for explicit recovery')
 assert.deepEqual(errors,[]);mark('no uncaught browser errors')
}catch(error){failure={name:error.name,message:error.message};await shot('failure').catch(()=>{});await fs.writeFile(path.join(shots,'failure.txt'),String(error)+'\n'+await page.locator('body').innerText().catch(()=>''));throw error}
finally{const finishedAt=new Date().toISOString(),result=JSON.stringify({scope:process.argv.includes('--gamemap-only')?'gamemap':'full',passed:!failure,failure,checks,errors,blocked,finishedAt},null,2);await fs.mkdir(path.resolve('../.ui-qa/optimization/frontend-fault-history'),{recursive:true});await fs.writeFile(path.resolve(`../.ui-qa/optimization/frontend-faults${process.argv.includes('--gamemap-only')?'-gamemap':''}.json`),result);await fs.writeFile(path.resolve(`../.ui-qa/optimization/frontend-fault-history/${finishedAt.replaceAll(':','-')}.json`),result);await browser.close()}
