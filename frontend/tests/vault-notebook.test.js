import test from 'node:test'
import assert from 'node:assert/strict'
import { previewCsv } from '../src/vault/components/csvImport.js'
import { loginName, accountIdentities, primaryWebsite, websiteUrl, accountOrder, accountSiteName, buildSiteOptions, matchesSite } from '../src/vault/components/accountBook.js'
import { analyzeSecurity, itemMatches } from '../src/vault/components/core.js'
import { restorePayload } from '../src/vault/components/backup.js'
import { accountGroupId, changeGroups, readGroups, validateGroups } from '../src/vault/components/groups.js'

test('explicit websites win over the login URL; legacy recognition uses hostname boundaries and never the login email', () => {
  const entry = value => ({ service:'邮箱', login:'person@gmail.com', urls:[{value}] })
  assert.equal(accountSiteName(entry('https://accounts.google.com/a')), '谷歌')
  assert.equal(accountSiteName(entry('https://login.microsoftonline.com/example')), '微软')
  assert.equal(accountSiteName({...entry('https://login.live.com'),site_name:'  校园门户  '}),'校园门户')
  assert.equal(accountSiteName({...entry(''),site_name:'  mIcRoSoFt  '}),'微软')
  assert.equal(accountSiteName(entry('https://google.com.example.test/login')),'google.com.example.test')
  assert.equal(accountSiteName(entry('https://login.microsoftonline.com@not-microsoft.example/login')),'not-microsoft.example')
  assert.equal(accountSiteName(entry('localhost:8080/login')),'localhost:8080')
  assert.equal(accountSiteName(entry('javascript:alert(1)')),'')
  assert.equal(accountSiteName(entry('')),'')
})

test('site suggestions reuse custom names, filters only include used sites, English aliases work in search', () => {
  const items = ['Google','谷歌',' Paper Desk ','paper desk'].map(site_name=>({data:{site_name,service:'个人账号'}}))
  const {editor,filter} = buildSiteOptions(items)
  assert.deepEqual(editor.map(option=>option.value).sort(), ['谷歌','微软','Paper Desk'].sort())
  assert.deepEqual(filter.map(option=>option.value).sort(), ['', '谷歌','Paper Desk'].sort())
  assert.ok(matchesSite(items[3].data,'Paper Desk'))
  assert.ok(itemMatches(items[1],'Google 个人'))
  assert.ok(itemMatches({data:{urls:[{value:'login.live.com'}]}},'微软'))
})

test('duplicate logins use website identity across record names and keep distinct websites separate', () => {
  const records = [
    {service:'工作邮箱',site_name:'谷歌'},{service:'另一个名称',urls:[{value:'accounts.google.com'}]},
    {service:'工作邮箱',site_name:'Microsoft'},{service:'历史名称'},{service:'历史名称'},
  ].map((data,id)=>({id,data:{...data,username:'same@example.test'}}))
  assert.deepEqual(analyzeSecurity(records).duplicate.map(g=>g.map(i=>i.id)), [[0,1],[3,4]])
  assert.equal(analyzeSecurity([{data:{service:'密钥甲',site_name:'微软'}},{data:{service:'密钥乙',site_name:'微软'}}]).duplicate.length,0)
})

test('vault CSV preserves the optional website column and distinguishes URL-less logins by site', () => {
  const csv='name,url,username,password,notes,site_name\n工作邮箱,,owner,pw,,Google\n工作邮箱,,owner,pw,,Microsoft\n移入账号,,owner,pw,,谷歌\n工作门户,,writer,pw,,"纸张,工坊"'
  const rows=previewCsv(csv,[])
  assert.deepEqual(rows.map(row=>row.status),['new','new','duplicate','new'])
  assert.deepEqual(rows.filter(row=>row.data).map(row=>row.data.site_name),['谷歌','微软','纸张,工坊'])
  assert.equal(previewCsv('所属网站,登录账号,密码\nMicrosoft,owner,pw',[])[0].data.service,'微软')
  const standard=previewCsv('name,url,username,password\n工作邮箱,login.live.com,owner,pw',[])[0].data
  assert.equal(standard.site_name,''); assert.equal(accountSiteName(standard),'微软')
  const sharedUrl='name,url,username,password,site_name\n邮箱,sso.example.test,owner,pw,Google\n邮箱,sso.example.test,owner,pw,Microsoft\n邮箱,sso.example.test,owner,pw,谷歌'
  const shared=previewCsv(sharedUrl,[])
  assert.deepEqual(shared.map(row=>[row.site,row.status]),[['谷歌','new'],['微软','new'],['谷歌','duplicate']])
  assert.equal(previewCsv('name,url,username,password\n邮箱,sso.example.test,owner,pw',[{data:shared[1].data}])[0].status,'duplicate')
})

test('group membership survives renaming; missing or deleted IDs resolve to ungrouped', () => {
  const group = { id: 'work-id', name: ' 工作 ' }
  const created = changeGroups([], { action:'create', ...group })
  assert.deepEqual(created, [{ id:'work-id', name:'工作' }])
  assert.equal(changeGroups(created, { action:'create', ...group }), created)
  const renamed = changeGroups(created, { action:'rename', id:group.id, name:'Studio' })
  const names = new Map(renamed.map(g => [g.id,g.name]))
  assert.equal(accountGroupId({ group_id:group.id }, names), group.id)
  assert.equal(accountGroupId({}, names), '')
  assert.equal(itemMatches({data:{service:'画册'}}, '画册 studio', names.get(group.id)), true)
  assert.throws(() => changeGroups(renamed, { action:'create', id:'another', name:' studio ' }), /同名/)
  assert.throws(() => validateGroups([{id:'',name:'test'}]), /标识/)
  assert.throws(() => validateGroups([{id:'test',name:'未分组'}]), /系统筛选/)
  assert.deepEqual(changeGroups(renamed, {action:'delete',id:group.id}), [])
  assert.equal(changeGroups(renamed, {action:'rename',id:group.id,name:' Studio '}), renamed)
  assert.equal(changeGroups(renamed, {action:'delete',id:'already-gone'}), renamed)
  assert.equal(accountGroupId({group_id:group.id},new Map()), '')
})

test('group catalogs are authenticated during restore and only the cipher box is sent to the server', async () => {
  const {encryptBlob} = await import('../src/vault/components/crypto.js')
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
  const groups = [{id:'stable-id',name:'演示分组'}]
  const box = await encryptBlob(key,groups)
  const payload = restorePayload({account:{kdf_params:{},wrapped_vault_key:box,recovery_wrapped_vault_key:box,
    group_catalog:{...box,label:'local-only'}},items:[]}, null)
  assert.deepEqual(payload.account.group_catalog, box)
  assert.equal(JSON.stringify(payload).includes('演示分组'), false)
  assert.deepEqual(await readGroups(key, payload.account.group_catalog), groups)
  assert.deepEqual(await readGroups(key, null), [])
  await assert.rejects(readGroups(key,await encryptBlob(key,[{id:'a',name:''}])))
})

test('legacy username, email, phone and login identities resolve consistently for copying and search', () => {
  for (const data of [{ username: 'work' }, { email: 'work' }, { phone: 'work' },
    { identities: [{ role: 'recovery', value: 'other' }, { role: 'login', value: 'work' }] }, { account_id: 'work' }]) {
    assert.equal(loginName(data), 'work')
    assert.equal(itemMatches({ data: { ...data, service: 'Office', purpose: '个人' } }, 'office 个人 work'), true)
  }
  assert.deepEqual(accountIdentities({login:'main',email:'main',phone:'123',identities:[{role:'recovery',value:'backup'}]}), ['main','123','backup'])
  assert.equal(loginName({ login: '', email: 'other' }), '')
  assert.equal(loginName({ identities: [{role: 'recovery', value: 'old'}] }), '')
})

test('account URLs accept web sites and local ports, skip unsafe and empty schemes', () => {
  assert.equal(websiteUrl('example.test:8080/login'), 'https://example.test:8080/login')
  assert.equal(websiteUrl('http://localhost:3000'), 'http://localhost:3000/')
  for (const url of ['javascript:alert(0)', 'data:text/plain,test', 'file:///private', '/local', '?relative', '']) assert.equal(websiteUrl(url), '')
  assert.equal(primaryWebsite({ urls: [{ value: 'file:///private' }, { value: 'example.test' }] }), 'https://example.test/')
})

test('favorites and actual usage sort ahead of the last edit', () => {
  const rows = [{id: 1, updated_at: '9'}, {id: 2, last_used_at: '5'}, {id: 3, favorite: true}, {id: 4, last_used_at: '7'}]
  assert.deepEqual(rows.map(row => ({ favorite: false, ...row })).sort(accountOrder).map(row => row.id), [3,4,2,1])
})

test('CSV preview supports BOM, quoted commas, quotes, newlines, Chinese headers and unchanged password spaces', () => {
  const csv = '\uFEFF名称,网址,登录账号,密码,备注\r\n"云,盘",https://cloud.test,李," p,""w"" ","一行\r\n二行"\r\n\r\n'
  const [row] = previewCsv(csv, [])
  assert.equal(row.status, 'new'); assert.equal(row.service, '云,盘')
  assert.equal(row.data.password.value, ' p,"w" '); assert.equal(row.data.notes, '一行\r\n二行')
})

test('browser import deduplicates across saved aliases, file rows and conflicting passwords while preserving other logins', () => {
  const saved = [{ data: { service: 'old', phone: 'Lisa', password: { value: 'old' }, urls: [{value:'other.test'}, {value:'site.test/start'}] } }]
  const csv = 'name,url,username,password\nsame,https://site.test/login,Lisa,old\nold,site.test,Lisa,changed\nnew,site.test,lisa,new\nagain,site.test,lisa,new\nbad,file:///x,x,q\nmissing,site.test,w,\nshort,site.test\n'
  const rows = previewCsv(csv, saved)
  assert.deepEqual(rows.map(r => r.status), ['duplicate','conflict','new','duplicate','invalid','invalid','invalid'])
  assert.equal(rows.filter(r => r.data).length, 1)
  assert.throws(() => previewCsv('username,password\nu,p', []))
  assert.throws(() => previewCsv('name,username,password\n"broken,user,p', []))
})

test('restore sends only ciphertext and the supported metadata, including legacy account formats', () => {
  const box = { n:'n', ct:'ct', extra:'local-only' }
  const payload = restorePayload({ format:'doublog-vault-backup', account:{
    kdf_params:'{"m":32768,"t":2,"p":1}', wrapped_vault_key:box, recovery_wrapped_vault_key:box,
  }, custom_categories:['local-only'], items:[{id:1, blob:box, notes:'local-only'}], attachments:[{item_id:1, blob:box, size:7, filename:'local-only'}] }, null)
  assert.equal(payload.version, 1); assert.equal(payload.expected_key, null)
  assert.deepEqual(payload.account.kdf_params, {t:2,m:32768,p:1})
  assert.equal(JSON.stringify(payload).includes('local-only'), false)
})


test('recovery reset preserves nondefault legacy KDF parameters, the original VEK and the recovery channel', async () => {
  const { argon2id } = await import('@noble/hashes/argon2.js')
  const { rewrapVaultKey, unlockVault, decryptBlob, encryptBlob, toB64 } = await import('../src/vault/components/crypto.js')
  const params = { m: 8192, t: 1, p: 1 }
  const original = crypto.getRandomValues(new Uint8Array(32))
  async function wrap(secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
    const derived = argon2id(new TextEncoder().encode(secret), salt, { ...params, dkLen:32 })
    const kek = await crypto.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt'])
    const bytes = await crypto.subtle.encrypt({name:'AES-GCM',iv}, kek, original)
    derived.fill(0)
    return { salt:toB64(salt), box:{n:toB64(iv), ct:toB64(bytes)} }
  }
  const recovery = 'aa22'.repeat(16), current = await wrap('old master'), alt = await wrap(recovery)
  const account = { kdf_params:params, kdf_salt:current.salt, recovery_salt:alt.salt, wrapped_vault_key:current.box, recovery_wrapped_vault_key:alt.box }
  original.fill(0)
  const sample = await encryptBlob(await unlockVault(account, 'old master', false), {service:'legacy fixture'})
  const replacement = await rewrapVaultKey(account,recovery,true,'replacement',false)
  assert.deepEqual(replacement.params,params)
  const next = {...account, kdf_params:replacement.params, kdf_salt:replacement.salt, wrapped_vault_key:replacement.box}
  for (const [secret,recover] of [['replacement',false],[recovery,true]]) {
    const key = await unlockVault(next,secret,recover)
    assert.equal(key.extractable,false)
    assert.deepEqual(await decryptBlob(key,sample),{service:'legacy fixture'})
  }
  await assert.rejects(unlockVault(next,'old master',false))
})
