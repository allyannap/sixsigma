import { useCallback, useEffect, useState } from 'react'
import { getApi } from './api.js'

/**
 * Load one endpoint whenever its params change.
 * Returns {data, error, loading, reload}. delay (ms) waits before fetching (used by the slider).
 * The old answer is dropped as soon as params change, so a stale chart is never shown.
 */
export function useEndpoint(endpoint, params, { delay = 0, skip = false } = {}) {
  const key = JSON.stringify([endpoint, params, skip])
  const [state, setState] = useState({ data: null, error: null, loading: !skip })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (skip) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    const ctl = new AbortController()
    setState({ data: null, error: null, loading: true })
    const timer = setTimeout(() => {
      getApi(endpoint, params, { signal: ctl.signal })
        .then((data) => setState({ data, error: null, loading: false }))
        .catch((e) => {
          if (e.name !== 'AbortError') setState({ data: null, error: e.message, loading: false })
        })
    }, delay)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
    // key already contains endpoint, params and skip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, delay])

  return { ...state, reload }
}
