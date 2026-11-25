import { useEffect, useRef, useState } from 'react'
import { vaultAppendItems, vaultImport, vaultListItems } from '../api'
import { decryptBlob, encryptBlob, unlockVault } from './crypto'
import { createVaultTaskScope, decryptBatches } from './session'
import { previewCsv } from './csvImport'

import { restorePayload } from './backup.js'
import { readGroups } from './groups.js'

const button = 'vault-button'
const primary = 'vault-button vault-primary'
const statusLabels = { new: '可追加', duplicate: '重复，跳过', conflict: '已有账号，密码不同', invalid: '资料不完整或格式错误' }
const PAGE_SIZE = 20

function useFileJob(session) {
  const current = useRef(null)
  useEffect(() => () => current.current?.dispose(), [session])
  return () => {
    current.current?.dispose()
    current.current = createVaultTaskScope(session)
    return current.current
  }
}

export function CsvImport({ account, session, getVaultKey, onAppended }) {
  const start = useFileJob(session)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(false)

  async function read(selected) {
    if (!selected) return
    const job = start()
    setFile(selected); setPreview(null); setPage(0); setMessage(''); setBusy(true); setRetry(false)
    try {
      const [source, response] = await Promise.all([selected.text(), vaultListItems(false, { signal: job.signal })])
      job.assert()
      if (!response.success) throw new Error(response.message || '读取账号失败')
      const stored = response.data.items, vek = getVaultKey()
      const plain = await decryptBatches(stored, async item => ({ data: await decryptBlob(vek, item.blob) }), { isCurrent: job.isCurrent })
      job.assert()
      if (plain.length !== stored.length) throw new Error('部分已有账号无法解密，无法完成去重。请检查备份后重新预览。')
      const rows = previewCsv(source, plain)
      setPreview({ rows, snapshot: stored.map(item => [item.id, item.blob.n]) })
    } catch (err) {
      if (job.isCurrent()) setMessage(err.message || '读取 CSV 失败')
    } finally { if (job.isCurrent()) setBusy(false) }
  }

  async function append() {
    if (!preview || busy || retry) return
    const job = start()
    setBusy(true); setMessage('')
    try {
      const boxes = [], vek = getVaultKey()
      for (const row of preview.rows) {
        if (row.status !== 'new') continue
        job.assert()
        boxes.push(await encryptBlob(vek, row.data))
      }
      job.assert()
      const result = await vaultAppendItems({ expected_key: account.kdf_salt, expected_items: preview.snapshot, items: boxes }, { signal: job.signal })
      job.assert()
      if (!result.success) throw new Error(result.message || '追加失败')
      setPreview(null); setFile(null); setMessage('已追加 ' + result.data.imported_items + ' 个账号')
      await onAppended()
    } catch (err) {
      if (job.isCurrent()) { setRetry(true); setMessage(err.message || '请重新预览并核对已导入的账号') }
    } finally { if (job.isCurrent()) setBusy(false) }
  }

  const count = preview?.rows.filter(row => row.status === 'new').length || 0
  return <section className="vault-transfer">
    <h4>从浏览器导入 CSV</h4>
    <p>选择浏览器导出的密码文件，在本机预览和加密。同一网站和登录账号的重复记录会跳过。</p>
    <label className={button}>选择 CSV 文件
      <input aria-label="选择 CSV 文件" type="file" accept=".csv,text/csv" className="sr-only" disabled={busy}
        onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; read(selected) }} />
    </label>
    {preview && <>
      <p>{file.name} · 可追加 {count} 项 · 跳过 {preview.rows.length - count} 项</p>
      <div className="vault-preview"><table><thead><tr><th>名称</th><th>所属网站</th><th>登录账号</th><th>处理</th></tr></thead>
        <tbody>{preview.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row =>
          <tr key={row.line}><td>{row.service || '—'}</td><td>{row.site || '—'}</td><td>{row.login || '—'}</td><td>{statusLabels[row.status]}</td></tr>)}</tbody></table></div>
      {preview.rows.length > PAGE_SIZE && <div className="vault-actions">
        <button className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页</button>
        <span>{page + 1} / {Math.ceil(preview.rows.length / PAGE_SIZE)}</span>
        <button className={button} disabled={(page + 1) * PAGE_SIZE >= preview.rows.length} onClick={() => setPage(page + 1)}>下一页</button>
      </div>}
      <div className="vault-actions">
        <button className={primary} disabled={!count || busy || retry} onClick={append}>追加 {count} 个账号</button>
        <button className={button} disabled={busy} onClick={() => { start(); setFile(null); setPreview(null); setMessage('') }}>取消</button>
      </div>
    </>}
    {file && (retry || (!preview && !busy && message)) && <button className={button} onClick={() => read(file)}>重新预览</button>}
    {(busy || message) && <p role="status">{busy ? '正在处理…' : message}</p>}
  </section>
}

export function BackupRestore({ account, session, onRestored }) {
  const start = useFileJob(session)
  const [backup, setBackup] = useState(null)
  const [secret, setSecret] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function read(file) {
    if (!file) return
    const job = start()
    setBusy(true); setBackup(null); setSecret(''); setRecovery(false); setMessage('')
    try {
      const value = JSON.parse(await file.text())
      job.assert()
      if (!['doublog-vault-backup', 'doublog-vault-backdown'].includes(value?.format)
        || ![1, 2].includes(value.version ?? 1) || !value.account || !Array.isArray(value.items)
        || (value.version === 2 && !Array.isArray(value.attachments))) throw new Error('备份格式不正确')
      setBackup(value)
    } catch (err) { if (job.isCurrent()) setMessage(err instanceof SyntaxError ? '无法解析备份文件' : err.message) }
    finally { if (job.isCurrent()) setBusy(false) }
  }

  async function restore() {
    if (!backup || !secret || busy) return
    const job = start()
    setBusy(true); setMessage('')
    try {
      const encrypted = restorePayload(backup, account?.kdf_salt ?? null)
      const key = await unlockVault(encrypted.account, secret, recovery)
      await readGroups(key, encrypted.account.group_catalog)
      job.assert()
      const categories = backup.category_catalog ? await decryptBlob(key, backup.category_catalog) : backup.custom_categories
      for (const rows of [backup.items, backup.attachments || []]) {
        for (const row of rows) { job.assert(); await decryptBlob(key, row.blob) }
      }
      job.assert()
      const result = await vaultImport(encrypted, { signal: job.signal })
      job.assert()
      if (!result.success) throw new Error(result.message || '恢复失败')
      setSecret(''); setBackup(null)
      await onRestored(Array.isArray(categories) ? categories : [])
    } catch (err) {
      if (job.isCurrent()) setMessage(err.name === 'OperationError' ? '备份口令不匹配或密文受损' : err.message || '恢复失败')
    } finally { if (job.isCurrent()) setBusy(false) }
  }

  return <section className="vault-transfer">
    <h4>恢复加密备份</h4>
    <p>{account ? '确认恢复后，备份将替换当前密码库的账号和附件。' : '已有备份可以直接恢复到此设备。'}</p>
    <label className={button}>选择加密备份
      <input aria-label="选择加密备份" type="file" accept=".json" className="sr-only" disabled={busy}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; read(file) }} />
    </label>
    {backup && <div className="vault-import-confirm">
      <p>包含 {backup.items.length} 个账号、{backup.attachments?.length || 0} 个附件{(backup.version ?? 1) === 1 ? '（旧版备份不含附件）' : ''}。</p>
      <label className="block mb-2"><input type="checkbox" checked={recovery} disabled={busy} onChange={e => { setRecovery(e.target.checked); setSecret('') }} /> 使用备份的恢复密钥</label>
      <input type="password" aria-label="备份验证口令" autoComplete="off" placeholder={recovery ? '备份的恢复密钥' : '备份的主密码'}
        className="vault-input" value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} />
      <div className="vault-actions">
        <button className={primary} disabled={busy || !secret} onClick={restore}>{account ? '验证并替换当前库' : '验证并恢复'}</button>
        <button className={button} disabled={busy} onClick={() => { start(); setBackup(null); setSecret(''); setMessage('') }}>取消</button>
      </div>
    </div>}
    {(busy || message) && <p role="status">{busy ? '正在验证并处理备份…' : message}</p>}
  </section>
}
