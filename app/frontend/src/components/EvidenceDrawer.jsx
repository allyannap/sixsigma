import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** Native modal keeps focus in the evidence panel and returns it to its opener. */
export default function EvidenceDrawer({ open, onClose, children, title = 'Area details', titleId = 'comparison-drawer-title', className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    const previous = document.body.style.overflow
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])
  const dialog = <dialog ref={ref} className={`comparison-drawer ${className}`} aria-labelledby={titleId}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const items = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="comparison-drawer-inner">
      <header className="comparison-drawer-head">
        <div><span className="eyebrow">Wait time insights</span><h2 id={titleId}>{title}</h2></div>
        <button type="button" className="comparison-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button>
      </header>
      <div className="comparison-drawer-body">{children}</div>
    </div>
  </dialog>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
