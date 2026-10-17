import { useEffect, useId, useRef } from 'react'

/** Native modal: traps focus, makes the workspace inert, and restores focus on close. */
export default function EvidencePanel({ open, onClose, title, children }) {
  const ref = useRef(null)
  const heading = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!open) { if (dialog.open) dialog.close(); return undefined }
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = overflow }
  }, [open])
  return <dialog ref={ref} className="evidence-dialog" aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === ref.current) {
      const b = ref.current.getBoundingClientRect()
      if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose()
    } }}>
    <div className="evidence-heading"><h2 id={heading}>{title}</h2><button type="button" className="btn btn-small" onClick={onClose} autoFocus>Close <span aria-hidden="true">×</span></button></div>
    <div className="evidence-content">{children}</div>
  </dialog>
}
