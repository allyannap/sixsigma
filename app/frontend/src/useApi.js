import { useCallback, useEffect, useState } from 'react'
import { getApi } from './api.js'

/**
 * Load one endpoint whenever its params change.
 * Returns {data, error, loading, reload}. delay (ms) waits before fetching (used by the slider).
 * The old answer is dropped as soon as params change, so a stale chart is never shown.
 */
export function useEndpoint(endpoint, params, { delay = 0, skip = false } = {}) {
  const key = JSON.stringify([endpoint, params, skip])
  const [state, setState] = useState({ key, data: null, error: null, loading: !skip })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (skip) {
      setState({ key, data: null, error: null, loading: false })
      return undefined
    }
    const ctl = new AbortController()
    setState({ key, data: null, error: null, loading: true })
    const timer = setTimeout(() => {
      getApi(endpoint, params, { signal: ctl.signal })
        .then((data) => { if (!ctl.signal.aborted) setState({ key, data, error: null, loading: false }) })
        .catch((e) => {
          if (!ctl.signal.aborted && e.name !== 'AbortError') setState({ key, data: null, error: e.message, loading: false })
        })
    }, delay)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
    // key already contains endpoint, params and skip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, delay])

  return { ...(state.key === key ? state : { data: null, error: null, loading: !skip }), reload }
}
