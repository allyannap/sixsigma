import { useEffect, useRef, useState } from 'react'

/** Match the SVG coordinate space to its rendered box so labels keep their readable size. */
export function usePlotSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 640, height: 200 })
  useEffect(() => {
    if (!ref.current) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}
