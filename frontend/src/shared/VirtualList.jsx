import { useRef, useState, useLayoutEffect, useImperativeHandle } from 'react'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'

function Rows({ virtualizer, items, renderItem, className = '', margin = 0 }) {
  return <div className={className} style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }} data-virtual-total={items.length}>
    {virtualizer.getVirtualItems().map(row => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start - margin}px)` }}>
      {renderItem(items[row.index], row.index)}
    </div>)}
  </div>
}
function ElementList({ items, renderItem, getKey, estimateSize, height, overscan, className, listRef }) {
  const parent = useRef(null)
  // TanStack exposes live virtualizer methods; this adapter intentionally opts
  // out of compiler memoization and re-reads them on each library update.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => estimateSize, overscan,
    getItemKey: index => getKey?.(items[index], index) ?? index })
  useImperativeHandle(listRef, () => virtualizer, [virtualizer])
  return <div ref={parent} className={className} style={{ height, overflow: 'auto', overflowAnchor: 'none' }}>
    <Rows {...{ virtualizer, items, renderItem }} />
  </div>
}
function WindowList({ items, renderItem, getKey, estimateSize, overscan, className, listRef }) {
  const parent = useRef(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const measure = () => setMargin(parent.current ? parent.current.getBoundingClientRect().top + window.scrollY : 0)
    measure()
    const observer = new ResizeObserver(measure); observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const virtualizer = useWindowVirtualizer({ count: items.length, estimateSize: () => estimateSize, overscan, scrollMargin: margin,
    getItemKey: index => getKey?.(items[index], index) ?? index })
  useImperativeHandle(listRef, () => virtualizer, [virtualizer])
  return <div ref={parent}><Rows {...{ virtualizer, items, renderItem, className, margin }} /></div>
}
export default function VirtualList({ items, renderItem, getKey, estimateSize = 48, height = 600, overscan = 8, className = '', windowScroll = false, listRef }) {
  const props = { items, renderItem, getKey, estimateSize, height, overscan, className, listRef }
  return windowScroll ? <WindowList {...props} /> : <ElementList {...props} />
}
