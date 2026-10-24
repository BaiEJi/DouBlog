import { useEffect, useLayoutEffect, useRef, useState } from 'react'

let runtime
function loadEditor() {
  runtime ||= Promise.all([
    import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/commands'),
    import('@codemirror/language'), import('@codemirror/theme-one-dark'),
  ]).then(([state, view, commands, syntax, dark]) => ({ ...state, ...view, ...commands, ...syntax, oneDark: dark.oneDark }))
  return runtime
}
const languages = new Map()
function loadLanguage(language) {
  if (!languages.has(language)) {
    const loaders = { json: () => import('@codemirror/lang-json').then(module => module.json()),
      javascript: () => import('@codemirror/lang-javascript').then(module => module.javascript()),
      markdown: () => import('@codemirror/lang-markdown').then(module => module.markdown()) }
    languages.set(language, loaders[language]?.() || Promise.resolve([]))
  }
  return languages.get(language)
}

/** CodeMirror stays mounted across value/theme changes: selection and undo survive. */
export default function CodeEditor({ value = '', onChange, language = 'text', readOnly = false, height = 320,
  ariaLabel = '代码编辑器', onSave, onBlur, className = '', editorRef, id, onReady, onPaste, onDrop, onDragOver }) {
  const host = useRef(null), editor = useRef(null), api = useRef(null), config = useRef(null)
  const latest = useRef({ value, onChange, onSave, onBlur, language, readOnly, ariaLabel, editorRef, id, onReady, onPaste, onDrop, onDragOver })
  useLayoutEffect(() => { latest.current = { value, onChange, onSave, onBlur, language, readOnly, ariaLabel, editorRef, id, onReady, onPaste, onDrop, onDragOver } })
  const [ready, setReady] = useState(false)
  const large = value.length > 1_000_000
  const [failure, setFailure] = useState(false)
  useEffect(() => {
    let alive = true, observer, bridge, assignedRef
    loadEditor().then(cm => {
      if (!alive) return
      api.current = cm
      const theme = new cm.Compartment(), mode = new cm.Compartment(), editable = new cm.Compartment()
      const external = cm.Annotation.define()
      config.current = { theme, mode, editable, external }
      const instance = new cm.EditorView({ parent: host.current, state: cm.EditorState.create({ doc: latest.current.value, extensions: [
        cm.lineNumbers(), cm.highlightActiveLineGutter(), cm.drawSelection(), cm.history(), cm.EditorView.lineWrapping,
        cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
        cm.keymap.of([{ key: 'Mod-s', run: () => { if (!latest.current.onSave) return false; latest.current.onSave(); return true } }, ...cm.defaultKeymap, ...cm.historyKeymap]),
        theme.of(document.documentElement.classList.contains('dark') ? cm.oneDark : []), mode.of([]),
        editable.of([cm.EditorState.readOnly.of(latest.current.readOnly), cm.EditorView.editable.of(!latest.current.readOnly)]),
        cm.EditorView.contentAttributes.of({ 'aria-label': latest.current.ariaLabel, spellcheck: 'false', ...(latest.current.id ? { id: latest.current.id } : {}) }),
        cm.EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(external))) latest.current.onChange?.(update.state.doc.toString()) }),
        cm.EditorView.domEventHandlers({ blur: event => { latest.current.onBlur?.(event); return false },
          paste: event => { latest.current.onPaste?.(event); return event.defaultPrevented },
          drop: event => { latest.current.onDrop?.(event); return event.defaultPrevented },
          dragover: event => { latest.current.onDragOver?.(event); return event.defaultPrevented },
        }),
        cm.EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace' }, '.cm-gutters': { backgroundColor: 'transparent' } }),
      ] }) })
      editor.current = instance
      const select = (anchor, head) => instance.dispatch({ selection: { anchor: Math.max(0, Math.min(anchor, instance.state.doc.length)), head: Math.max(0, Math.min(head, instance.state.doc.length)) } })
      const eventTarget = type => type === 'scroll' ? instance.scrollDOM : instance.contentDOM
      bridge = {
        get selectionStart() { return instance.state.selection.main.from },
        set selectionStart(value) { select(value, Math.max(value, instance.state.selection.main.to)) },
        get selectionEnd() { return instance.state.selection.main.to },
        set selectionEnd(value) { select(Math.min(instance.state.selection.main.from, value), value) },
        get value() { return instance.state.doc.toString() },
        get scrollTop() { return instance.scrollDOM.scrollTop }, set scrollTop(value) { instance.scrollDOM.scrollTop = value },
        get scrollHeight() { return instance.scrollDOM.scrollHeight }, get clientHeight() { return instance.scrollDOM.clientHeight },
        get clientWidth() { return instance.scrollDOM.clientWidth }, get scrollWidth() { return instance.scrollDOM.scrollWidth },
        focus: () => instance.focus(), setSelectionRange: select,
        getBoundingClientRect: () => instance.dom.getBoundingClientRect(),
        addEventListener: (type, listener, options) => eventTarget(type).addEventListener(type, listener, options),
        removeEventListener: (type, listener, options) => eventTarget(type).removeEventListener(type, listener, options),
        view: instance,
      }
      assignedRef = latest.current.editorRef
      if (assignedRef) assignedRef.current = bridge
      setReady(true)
      latest.current.onReady?.(bridge)
      observer = new MutationObserver(() => instance.dispatch({ effects: theme.reconfigure(document.documentElement.classList.contains('dark') ? cm.oneDark : []) }))
      observer.observe(document.documentElement, { attributeFilter: ['class'] })
    }).catch(() => { if (alive) setFailure(true) })
    return () => { alive = false; observer?.disconnect(); if (assignedRef?.current === bridge) assignedRef.current = null; editor.current?.destroy(); editor.current = null }
  }, []) // configuration changes use compartments below
  useEffect(() => {
    const instance = editor.current
    if (!instance || instance.state.doc.toString() === value) return
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value }, selection: { anchor: Math.min(instance.state.selection.main.anchor, value.length) }, annotations: config.current.external.of(true) })
  }, [value, ready])
  useEffect(() => {
    if (!editor.current) return
    const cm = api.current, parts = config.current
    editor.current.dispatch({ effects: parts.editable.reconfigure([cm.EditorState.readOnly.of(readOnly), cm.EditorView.editable.of(!readOnly)]) })
    let active = true
    if (large) editor.current.dispatch({ effects: parts.mode.reconfigure([]) })
    else loadLanguage(language).then(extension => { if (active && editor.current) editor.current.dispatch({ effects: parts.mode.reconfigure(extension) }) }).catch(() => {
      if (active && editor.current) editor.current.dispatch({ effects: parts.mode.reconfigure([]) })
    })
    return () => { active = false }
  }, [language, readOnly, large, ready])
  return <div className={'rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] text-stone-800 dark:text-stone-100 overflow-hidden ' + className} style={{ height }} data-code-editor={language}>
    {failure ? <textarea ref={editorRef} id={id} value={value} readOnly={readOnly} aria-label={ariaLabel} onBlur={onBlur} onPaste={onPaste} onDrop={onDrop} onDragOver={onDragOver} onChange={event => onChange?.(event.target.value)}
      onKeyDown={event => { if (onSave && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() } }}
      className="w-full h-full px-3 py-2 outline-none font-mono text-[13px] bg-transparent" /> : <div ref={host} className="h-full" />}
  </div>
}
