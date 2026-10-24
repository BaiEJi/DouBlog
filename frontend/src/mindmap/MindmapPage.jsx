import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './mindmap.css'

const Library = lazy(() => import('./Library'))
const Editor = lazy(() => import('./Editor'))

export default function MindmapPage({ dark }) {
  return <div className="mindmap-module"><Suspense fallback={<div className="mm-loading" role="status">正在准备思维导图…</div>}><Routes><Route index element={<Library />} /><Route path=":id" element={<Editor dark={dark} />} /><Route path="*" element={<Navigate to="/mindmap" replace />} /></Routes></Suspense></div>
}
