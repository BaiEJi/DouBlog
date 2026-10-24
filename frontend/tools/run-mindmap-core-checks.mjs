import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright')
const base = process.env.MINDMAP_TEST_BASE || 'http://127.0.0.1:60111'
const output = path.resolve(process.env.MINDMAP_CORE_OUTPUT || '../docs/mindmap-core-results.json')
const artifactDirectory = path.join(path.dirname(output), 'mindmap-core-downloads')
await fs.mkdir(artifactDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || undefined })
const results = { recordedAt: new Date().toISOString(), browser: await browser.version(),
  device: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  viewport: { width: 1440, height: 900 }, headless: true, fixtureNodes: 25, cases: [], browserErrors: [] }
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`)

try {
  const context = await browser.newContext({ viewport: results.viewport, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', error => results.browserErrors.push(error.message))
  await page.goto(`${base}/tools/mindmap-core-checks.html`)
  await page.waitForFunction(() => typeof window.coreChecks?.reset === 'function')
  const api = (name, ...args) => page.evaluate(({ name, args }) => window.coreChecks[name](...args), { name, args })
  const reset = () => api('reset')
  const textNode = text => page.locator('.smm-text-node-wrap').filter({ hasText: new RegExp(`^${text}$`) }).first()
  const editBox = () => page.locator('.smm-node-edit-wrap:visible')
  async function check(name, run) {
    const started = performance.now()
    try { const evidence = await run(); results.cases.push({ name, passed: true, elapsedMs: performance.now() - started, evidence }); console.log(`PASS ${name}`) }
    catch (error) { results.cases.push({ name, passed: false, elapsedMs: performance.now() - started, error: error.stack || String(error) }); console.log(`FAIL ${name}: ${error.message}`) }
  }
  await check('initial-render-and-root-delete-key-protection', async () => {
    const initial = await reset()
    equal(initial.nodes.length, 25, 'Fixture must contain 25 nodes')
    equal(initial.metrics.renderedNodeCount, 25, 'Every expanded fixture node must be rendered')
    await api('select', 'check-0')
    await textNode('主题0').click()
    await page.keyboard.press('Delete')
    await api('ready')
    const after = await api('snapshot')
    equal(after.projection, initial.projection, 'Delete on root must preserve every child')
    return { nodeCount: after.nodes.length, rendered: after.metrics.renderedNodeCount, errors: after.errors }
  })
  await check('keyboard-tab-adds-child-and-edit-commit', async () => {
    await reset()
    await api('select', 'check-1')
    await textNode('主题1').click()
    await page.keyboard.press('Tab')
    await editBox().waitFor({ state: 'visible' })
    await editBox().fill('Tab新增的子主题')
    await page.keyboard.press('Enter')
    await api('ready')
    const snapshot = await api('snapshot')
    equal(snapshot.nodes.length, 26, 'Tab must create exactly one node')
    assert((await api('node', 'check-1')).children.some(node => node.data.text === 'Tab新增的子主题'), 'Tab child text must commit')
    return { nodeCount: snapshot.nodes.length }
  })
  await check('double-click-F2-and-unfinished-input-commit', async () => {
    await reset()
    await api('select', 'check-24')
    await textNode('主题24').dblclick()
    await editBox().fill('双击编辑主题')
    await page.keyboard.press('Enter')
    await api('ready')
    equal((await api('node', 'check-24')).data.text, '双击编辑主题', 'Double-click editing failed')
    await textNode('双击编辑主题').click()
    await page.keyboard.press('F2')
    await editBox().waitFor({ state: 'visible' })
    await editBox().fill('F2未结束的最后字符✓')
    await api('commit')
    await api('ready')
    equal((await api('node', 'check-24')).data.text, 'F2未结束的最后字符✓', 'commit must include the unfinished last character')
    return { finalText: (await api('node', 'check-24')).data.text }
  })
  await check('copy-cut-paste-and-unique-ids', async () => {
    await reset()
    await api('select', 'check-24'); await api('command', 'copy')
    await api('select', 'check-2'); await api('command', 'paste')
    let snapshot = await api('snapshot')
    equal(snapshot.nodes.length, 26, 'Copy/paste must add one leaf')
    equal(snapshot.nodes.filter(node => node.text === '主题24').length, 2, 'Copied text must survive')
    await api('select', 'check-23'); await api('command', 'cut')
    equal((await api('snapshot')).nodes.length, 25, 'Cut must remove its leaf')
    await api('select', 'check-3'); await api('command', 'paste')
    snapshot = await api('snapshot')
    equal(snapshot.nodes.length, 26, 'Pasting cut leaf must restore it')
    assert((await api('node', 'check-3')).children.some(node => node.data.text === '主题23'), 'Cut leaf must move to chosen parent')
    equal(new Set(snapshot.nodes.map(node => node.uid)).size, 26, 'Clipboard operations must regenerate unique ids')
    return { nodeCount: snapshot.nodes.length, errors: snapshot.errors }
  })
  const relationFixture = () => ({ layout: 'mindMap', theme: { template: 'default', config: {} }, root: {
    data: { uid: 'rel-root', text: '关系复制测试', expand: true }, children: [
      { data: { uid: 'rel-branch', text: '带关系的分支', expand: true, generalization: [{ uid: 'rel-summary', text: '分支概要', range: [0, 1] }] }, children: [
        { data: { uid: 'rel-a', text: '关系起点', expand: true, associativeLineTargets: ['rel-b', 'rel-external'],
          associativeLineText: { 'rel-b': '内部关系', 'rel-external': '同图外部关系' },
          associativeLineStyle: { 'rel-b': { associativeLineColor: '#e11d48' }, 'rel-external': { associativeLineWidth: 3 } } }, children: [] },
        { data: { uid: 'rel-b', text: '关系终点', expand: true }, children: [] },
      ] },
      { data: { uid: 'rel-external', text: '焦点外节点', expand: true, associativeLineTargets: ['rel-a'], associativeLineText: { 'rel-a': '外部入线' } }, children: [] },
      { data: { uid: 'rel-target-1', text: '粘贴目标甲', expand: true }, children: [] },
      { data: { uid: 'rel-target-2', text: '粘贴目标乙', expand: true }, children: [] },
    ],
  } })
  function assertGraph(snapshot) {
    const ids = new Set(snapshot.nodes.map(node => node.uid)), summaryIds = new Set(), pending = [snapshot.document.root]
    while (pending.length) {
      const node = pending.pop(), data = node.data
      for (const target of data.associativeLineTargets || []) {
        assert(ids.has(target), `Dangling reference ${data.uid} -> ${target}`)
        assert(target !== data.uid, 'Relation cannot point to itself')
      }
      const summaries = data.generalization == null ? [] : Array.isArray(data.generalization) ? data.generalization : [data.generalization]
      for (const summary of summaries) { assert(!ids.has(summary.uid) && !summaryIds.has(summary.uid), 'Summary UID must be globally unique'); summaryIds.add(summary.uid) }
      pending.push(...(node.children || []))
    }
    return { normalIds: ids.size, summaryIds: summaryIds.size }
  }
  function assertCopiedBranch(branch, keepExternal) {
    const [a, b] = branch.children
    equal(a.data.associativeLineTargets, keepExternal ? [b.data.uid, 'rel-external'] : [b.data.uid], 'Internal relation must follow cloned target')
    equal(a.data.associativeLineText[b.data.uid], '内部关系', 'Relation text key must be remapped')
    assert(a.data.associativeLineStyle[b.data.uid], 'Relation style key must be remapped')
    assert(!Object.hasOwn(a.data.associativeLineText, 'rel-b'), 'Old internal UID must not survive in relation text')
    assert(branch.data.generalization[0].uid !== 'rel-summary', 'Summary UID must be regenerated')
  }
  await check('related-subtree-copied-twice-remaps-edges-and-summaries', async () => {
    await reset(); await api('load', relationFixture())
    // Actual nested Ctrl selection must copy its top ancestor only.
    await textNode('带关系的分支').click()
    await textNode('关系起点').click({ modifiers: ['Control'] })
    await page.keyboard.press('Control+c'); await api('ready')
    await api('select', 'rel-target-1'); await api('command', 'paste')
    await api('select', 'rel-target-1'); await api('command', 'paste')
    const target = await api('node', 'rel-target-1')
    equal(target.children.length, 2, 'Each paste must add exactly one top-level subtree')
    target.children.forEach(branch => assertCopiedBranch(branch, true))
    const snapshot = await api('snapshot'), graph = assertGraph(snapshot)
    equal(graph.normalIds, 13, 'Two 3-node copies must add exactly 6 nodes')
    equal(graph.summaryIds, 3, 'Original and both copied summaries must have distinct UIDs')
    await api('validate')
    return { ...graph, copiedRoots: target.children.map(node => node.data.uid), errors: snapshot.errors }
  })
  await check('multi-target-native-paste-is-atomic-for-undo-and-redo', async () => {
    await reset(); await api('load', relationFixture())
    await api('select', 'rel-branch'); await api('command', 'copy')
    await textNode('粘贴目标甲').click()
    await textNode('粘贴目标乙').click({ modifiers: ['Control'] })
    await api('ready')
    equal((await api('snapshot')).selected.length, 2, 'Both paste destinations must be selected')
    await page.keyboard.press('Control+v'); await api('ready')
    for (const id of ['rel-target-1', 'rel-target-2']) {
      const target = await api('node', id)
      equal(target.children.length, 1, 'Each destination must receive a separate copy')
      assertCopiedBranch(target.children[0], true)
    }
    const pasted = assertGraph(await api('snapshot'))
    await api('command', 'undo')
    for (const id of ['rel-target-1', 'rel-target-2']) equal((await api('node', id)).children.length, 0, 'One undo must remove all destinations of one paste')
    await api('command', 'redo')
    for (const id of ['rel-target-1', 'rel-target-2']) equal((await api('node', id)).children.length, 1, 'One redo must restore all paste destinations')
    await api('validate')
    return pasted
  })
  await check('delete-cut-and-focused-undo-clean-dangling-snapshot-relations', async () => {
    await reset(); await api('load', relationFixture())
    await api('focus', 'rel-branch'); await api('select', 'rel-a')
    await api('command', 'delete')
    let snapshot = await api('snapshot')
    assertGraph(snapshot); await api('validate')
    equal((await api('node', 'rel-external')).data.associativeLineTargets, [], 'Export must remove incoming edges from outside the focused branch')
    await api('command', 'undo')
    snapshot = await api('snapshot'); assertGraph(snapshot); await api('validate')
    equal((await api('node', 'rel-external')).data.associativeLineTargets, ['rel-a'], 'Undo must restore incoming edges from outside focus')
    equal((await api('node', 'rel-a')).data.associativeLineTargets, ['rel-b', 'rel-external'], 'Valid out-of-focus targets must never be pruned')
    await api('unfocus'); await api('select', 'rel-branch'); await api('command', 'cut')
    assertGraph(await api('snapshot')); await api('validate')
    equal((await api('node', 'rel-external')).data.associativeLineTargets, [], 'Cut must export no dangling incoming reference')
    await api('select', 'rel-target-1'); await api('command', 'paste')
    assertCopiedBranch((await api('node', 'rel-target-1')).children[0], true)
    assertGraph(await api('snapshot')); await api('validate')
    return { focusedUndoRestoredExternalReference: true, cutPastePreservedInternalReference: true }
  })
  await check('cross-map-paste-drops-external-edges-and-rejects-invalid-content-before-mutation', async () => {
    await reset(); await api('load', relationFixture())
    await api('select', 'rel-branch'); await api('command', 'copy')
    const destination = { layout: 'mindMap', theme: { template: 'default', config: {} }, root: { data: { uid: 'other-root', text: '另一个导图', expand: true }, children: [] } }
    await api('load', destination); await api('select', 'other-root'); await api('command', 'paste')
    assertCopiedBranch((await api('node', 'other-root')).children[0], false)
    const before = (await api('snapshot')).projection
    await page.evaluate(() => navigator.clipboard.writeText(JSON.stringify({ simpleMindMap: true, data: [{ data: { uid: 'unsafe', text: 'unsafe', hyperlink: 'javascript:alert(1)' }, children: [] }] })))
    await api('select', 'other-root'); await api('command', 'paste')
    equal((await api('snapshot')).projection, before, 'Rejected clipboard must leave destination unchanged')
    assertGraph(await api('snapshot')); await api('validate')
    return { crossMapExternalTargetsDropped: true, rejectedBeforeMutation: true }
  })
  await check('real-ctrl-multiselect-and-batch-style', async () => {
    await reset()
    await textNode('主题21').click()
    await textNode('主题22').click({ modifiers: ['Control'] })
    await api('ready')
    equal((await api('snapshot')).selected.map(node => node.uid).sort(), ['check-21', 'check-22'], 'Ctrl-click must select both nodes')
    await api('patch', { fillColor: '#e0e7ff', color: '#312e81', fontWeight: 'bold', fontSize: 18 })
    for (const id of ['check-21', 'check-22']) {
      const data = (await api('node', id)).data
      equal([data.fillColor, data.fontWeight, data.fontSize], ['#e0e7ff', 'bold', 18], 'Batch style must apply to every selected node')
    }
    assert((await api('node', 'check-20')).data.fontWeight !== 'bold', 'Unselected node must stay unchanged')
    return { selected: (await api('snapshot')).selected.map(node => node.uid) }
  })
  await check('reparent-order-and-cycle-rejection', async () => {
    await reset()
    await api('move', 'check-24', 'check-2', 0)
    equal((await api('node', 'check-2')).children[0].data.uid, 'check-24', 'Requested sibling index must apply')
    const before = (await api('snapshot')).projection
    let rejected = false
    try { await api('move', 'check-2', 'check-24', 0) } catch { rejected = true }
    assert(rejected, 'Moving parent below descendant must reject')
    equal((await api('snapshot')).projection, before, 'Rejected cycle must leave map intact')
    return { destinationChildren: (await api('node', 'check-2')).children.map(node => node.data.uid), cycleRejected: rejected }
  })
  await check('undo-redo-retains-edited-data', async () => {
    await reset()
    await api('select', 'check-24')
    await api('patch', { text: '撤销重做主题' })
    await api('command', 'undo')
    equal((await api('node', 'check-24')).data.text, '主题24', 'Undo must restore original text')
    await api('command', 'redo')
    equal((await api('node', 'check-24')).data.text, '撤销重做主题', 'Redo must restore edited text')
    return { text: (await api('node', 'check-24')).data.text }
  })
  await check('focus-edits-merge-full-tree-and-save-callback', async () => {
    const initial = await reset()
    await api('focus', 'check-1')
    await api('select', 'check-5')
    await api('patch', { text: '聚焦内编辑' })
    const focused = await api('snapshot')
    equal(focused.nodes.length, 25, 'Focused document must still contain complete map')
    equal(focused.lastChange.root.data.uid, 'check-0', 'Save callback must keep original root')
    equal(focused.lastChange.root.children[1], initial.document.root.children[1], 'Other branches must remain intact')
    await api('unfocus')
    equal((await api('node', 'check-5')).data.text, '聚焦内编辑', 'Focus edit must survive return')
    equal((await api('snapshot')).metrics.renderedNodeCount, 25, 'Unfocus must restore complete rendering')
    return { fullNodes: focused.nodes.length, callbackRoot: focused.lastChange.root.data.uid }
  })
  await check('dark-pan-zoom-do-not-autosave', async () => {
    const initial = await reset()
    await api('dark', true); await api('dark', false); await api('view')
    const snapshot = await api('snapshot')
    equal(snapshot.changes, initial.changes, 'Appearance/view-only changes must not mark content dirty')
    equal(snapshot.projection, initial.projection, 'View operations must preserve content')
    return { changesBefore: initial.changes, changesAfter: snapshot.changes, scale: snapshot.metrics.scale }
  })
  await check('readonly-blocks-api-shortcuts-and-doubleclick', async () => {
    await reset(); await api('readonly', true)
    const initial = await api('snapshot')
    let rejected = 0
    try { await api('patch', { text: '不应写入' }) } catch { rejected++ }
    try { await api('command', 'addChild') } catch { rejected++ }
    await textNode('主题24').dblclick()
    await page.keyboard.press('Tab'); await page.keyboard.press('Delete'); await page.keyboard.press('Control+v')
    await api('ready')
    equal(await editBox().count(), 0, 'Readonly double-click must not create edit box')
    const snapshot = await api('snapshot')
    equal(snapshot.projection, initial.projection, 'Readonly shortcuts/API must preserve content')
    equal(snapshot.changes, initial.changes, 'Readonly attempts must not autosave')
    equal(rejected, 2, 'Readonly mutating API calls must reject explicitly')
    return { rejectedCalls: rejected, nodeCount: snapshot.nodes.length, contentChanges: snapshot.changes }
  })
  await check('markdown-multiple-headings-and-lists-preserved', async () => {
    await reset()
    const imported = await api('importText', '# 第一部分\n\n- 项目甲\n  - 子项甲\n\n# 第二部分\n\n段落乙\n\n## 子章节\n\n- 项目乙\n', '多标题.md')
    equal(imported.root.data.text, '多标题', 'Multiple roots need filename wrapper')
    equal(imported.root.children.map(node => node.data.text), ['第一部分', '第二部分'], 'Both top headings must survive')
    const texts = JSON.stringify(imported)
    for (const value of ['项目甲', '子项甲', '段落乙', '子章节', '项目乙']) assert(texts.includes(value), `Missing Markdown content: ${value}`)
    equal((await api('snapshot')).nodes.length, 25, 'Parsing external content must not alter current map')
    return { topHeadings: imported.root.children.map(node => node.data.text) }
  })
  await check('svg-png-xmind-markdown-real-downloads-and-roundtrip', async () => {
    const initial = await reset()
    const downloads = []
    for (const type of ['svg', 'png', 'xmind', 'markdown']) {
      const [download] = await Promise.all([page.waitForEvent('download'), api('export', type)])
      const filename = download.suggestedFilename()
      const target = path.join(artifactDirectory, filename)
      await download.saveAs(target)
      const bytes = await fs.readFile(target)
      assert(bytes.length > 0, `${type} download is empty`)
      if (type === 'svg') assert(bytes.toString().includes('<svg'), 'SVG download must contain actual SVG')
      if (type === 'png') equal([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature must be valid')
      if (type === 'xmind') equal([...bytes.subarray(0, 2)], [80, 75], 'XMind must be a ZIP container')
      if (type === 'markdown') assert(bytes.toString().includes('主题0'), 'Markdown must contain actual topics')
      const artifact = { type, filename, bytes: bytes.length }
      if (['xmind', 'markdown'].includes(type)) {
        const imported = await api('importBase64', bytes.toString('base64'), filename)
        equal(imported.count, 25, `${type} roundtrip must preserve topic count`)
        equal(imported.projection, initial.projection, `${type} roundtrip must preserve topic order and text`)
        artifact.roundtripNodes = imported.count
      }
      downloads.push(artifact)
    }
    return { downloads, boundary: 'Compare topic tree only; XMind/Markdown do not preserve complete styles, identity, relationships, or revision metadata.' }
  })
  await check('destroy-rebuild-cleans-tooltip-editor-and-events', async () => {
    await reset()
    const initial = (await api('snapshot')).resources
    const cycles = []
    for (let i = 0; i < 4; i++) {
      await api('select', 'check-24'); await textNode('主题24').dblclick()
      await editBox().fill(`销毁前编辑${i}`)
      const after = await api('destroy')
      equal([after.svg, after.editBoxes, after.tooltips], [0, 0, 0], 'Destroy must remove owned DOM and text editor')
      cycles.push(after)
      const rebuilt = await reset()
      equal(rebuilt.resources.svg, 1, 'Rebuild must have exactly one canvas')
      equal(rebuilt.resources.tooltips, initial.tooltips, 'Tooltip count must not accumulate')
      equal(rebuilt.resources.styles, initial.styles, 'Styles must not accumulate')
    }
    await textNode('主题1').click(); await page.keyboard.press('Tab')
    await editBox().fill('单次快捷键')
    await page.keyboard.press('Enter'); await api('ready')
    equal((await api('snapshot')).nodes.length, 26, 'One Tab after rebuild must run exactly once')
    return { cycles, finalNodes: (await api('snapshot')).nodes.length }
  })
  await api('destroy').catch(error => results.browserErrors.push(`Final cleanup: ${error.message}`))
  results.passed = results.cases.every(test => test.passed) && !results.browserErrors.length
  await fs.writeFile(output, JSON.stringify(results, null, 2))
  console.log(`Saved ${output}`)
  if (!results.passed) process.exitCode = 1
} finally { await browser.close() }
