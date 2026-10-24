import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright')
const base='http://127.0.0.1:60111',browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH}),context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage()
const checks=[],errors=[],blocked=[];let failure
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
await context.route('**/*',route=>{const u=new URL(route.request().url());if(['blob:','data:'].includes(u.protocol)||(u.hostname==='127.0.0.1'&&['60111','60113','60115'].includes(u.port)))return route.continue();blocked.push(u.origin+u.pathname);return route.abort()})
const api=async url=>{const r=await context.request.get(base+url);assert.ok(r.ok());return(await r.json()).data}
const mark=name=>{checks.push(name);console.log('PASS',name)}
const unlock=async()=>{await page.getByPlaceholder('输入主密码…').fill('QA-vault-password-only');await page.getByRole('button',{name:'解锁保险库',exact:true}).click();await page.getByRole('button',{name:'锁定',exact:true}).waitFor()}
const lock=async()=>{await page.getByRole('button',{name:'锁定',exact:true}).click();await page.getByText('密码库已锁定',{exact:true}).waitFor()}
try{
 await page.goto(base+'/login');assert.equal(await page.evaluate(async()=>(await import('/src/shared/client.js')).API_BASE),'')
 await page.getByPlaceholder('用户名',{exact:true}).fill('mindmap-qa');await page.getByPlaceholder('密码',{exact:true}).fill('qa-only-isolated-db');await page.getByRole('button',{name:'登 录'}).click();await page.waitForURL(base+'/')
 assert.match((await api('/api/admin/database')).data_dir,/\.ui-qa[\\/]optimization[\\/]browser-db-3/)
 const account=await api('/api/vault/account')
 const encrypted=await page.evaluate(async account=>{const{unlockVault,encryptBlob}=await import('/src/vault/components/crypto.js'),{emptyItem}=await import('/src/vault/components/core.js'),key=await unlockVault(account,'QA-vault-password-only'),out=[];for(let i=0;i<7;i++)out.push(await encryptBlob(key,{...emptyItem(),service:`QA cancel item ${i}`,password:{value:`QA cancellation unique password ${i}`}}));return out},account)
 // Replace seven ciphertexts only inside this browser response. No fixture
 // rows or real account parameters are changed by this cancellation test.
 await page.route('**/api/vault/items?trash=0',async route=>{const response=await route.fetch(),body=await response.json();body.data.items=body.data.items.slice(0,7).map((item,index)=>({...item,blob:encrypted[index]}));body.data.total=7;await route.fulfill({response,json:body})})
 await page.goto(base+'/vault');await unlock();await page.getByRole('button',{name:'安全中心',exact:true}).click()
 let hibpCalls=0,release;const held=new Promise(resolve=>{release=resolve})
 // Fulfill the exact external URL locally; generic routing still rejects all
 // other external traffic. This never reaches HIBP or sends a real password.
 await page.route('https://api.pwnedpasswords.com/range/*',async route=>{hibpCalls++;assert.match(new URL(route.request().url()).pathname,/^\/range\/[A-F0-9]{5}$/);assert.equal(route.request().headers()['add-padding'],'true');await held;await route.fulfill({status:200,body:'00000000000000000000000000000000000:0'}).catch(()=>{})})
 await page.getByRole('button',{name:'检查泄露',exact:true}).click();await page.waitForTimeout(300);assert.equal(hibpCalls,3)
 await page.evaluate(()=>{document.documentElement.classList.add('dark');localStorage.setItem('doublog_dark','true')});await page.screenshot({path:path.resolve('../.ui-qa/optimization/frontend-fault-shots/vault-security-dark.png')})
 await lock();release();await page.waitForTimeout(500);assert.equal(hibpCalls,3);assert.equal(await page.getByText('QA cancel item 0',{exact:true}).count(),0)
 mark('lock aborts three active HIBP requests; the remaining queue never starts or publishes')

 await unlock();await page.getByRole('button',{name:'全部条目',exact:false}).first().click();await page.getByText('QA cancel item 0',{exact:true}).click();await page.getByRole('button',{name:'＋ 加密上传附件',exact:true}).waitFor()
 let posts=0
 const countWrites=route=>{if(route.request().method()==='POST')posts++;return route.continue()}
 await page.route('**/api/vault/items/*/attachments',countWrites)
 await page.evaluate(()=>{window.qaOriginalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){window.qaFileReadStarted=true;return new Promise(resolve=>{window.qaReleaseFileRead=()=>resolve(new TextEncoder().encode('QA held file input').buffer)})}})
 await page.locator('input[type="file"]').setInputFiles({name:'qa-cancelled-upload.txt',mimeType:'text/plain',buffer:Buffer.from('QA held file input')});await page.waitForFunction(()=>window.qaFileReadStarted)
 await lock();await page.evaluate(()=>{window.qaReleaseFileRead();File.prototype.arrayBuffer=window.qaOriginalArrayBuffer});await page.waitForTimeout(450);assert.equal(posts,0)
 mark('lock during deferred file read prevents encryption continuation and attachment POST')

 await unlock();await page.getByRole('button',{name:'全部条目',exact:false}).first().click();await page.getByText('QA cancel item 0',{exact:true}).click();await page.getByRole('button',{name:'＋ 加密上传附件',exact:true}).waitFor()
 await page.evaluate(()=>{window.qaFileReadStarted=false;window.qaOriginalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){window.qaFileReadStarted=true;return new Promise(resolve=>{window.qaReleaseFileRead=()=>resolve(new TextEncoder().encode('QA held file input').buffer)})}})
 await page.locator('input[type="file"]').setInputFiles({name:'qa-unmounted-upload.txt',mimeType:'text/plain',buffer:Buffer.from('QA held file input')});await page.waitForFunction(()=>window.qaFileReadStarted)
 await page.getByText('QA cancel item 1',{exact:true}).click();await page.evaluate(()=>{window.qaReleaseFileRead();File.prototype.arrayBuffer=window.qaOriginalArrayBuffer});await page.waitForTimeout(450);assert.equal(posts,0)
 await page.screenshot({path:path.resolve('../.ui-qa/optimization/frontend-fault-shots/vault-attachments-dark.png')});await page.evaluate(()=>{document.documentElement.classList.remove('dark')});await page.screenshot({path:path.resolve('../.ui-qa/optimization/frontend-fault-shots/vault-attachments-light.png')})
 mark('selecting another item disposes attachment scope; old deferred input cannot write into either item')
 await page.unroute('**/api/vault/items/*/attachments',countWrites)
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);mark('no uncaught errors, real external traffic or server fixture writes')
}catch(error){failure={name:error.name,message:error.message};await page.screenshot({path:path.resolve('../.ui-qa/optimization/frontend-fault-shots/vault-cancellation-failure.png')}).catch(()=>{});throw error}
finally{await fs.writeFile(path.resolve('../.ui-qa/optimization/vault-cancellation-results.json'),JSON.stringify({passed:!failure,failure,checks,errors,blocked,finishedAt:new Date().toISOString()},null,2));await browser.close()}
