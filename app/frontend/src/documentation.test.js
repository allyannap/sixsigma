import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Documentation, { findDocumentationSections } from './components/Documentation.jsx'

const html = renderToString(h(Documentation, { open: true, onClose() {} }))

describe('dashboard documentation', () => {
  it('provides a labeled, live search field and result status', () => {
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Documentation contents"')
    expect(html).toContain('aria-describedby="documentation-search-status"')
    expect(html).toContain('Search terms across all sections.')
  })

  it('matches every query term case-insensitively and returns all sections for an empty query', () => {
    const sections = [
      { id: 'metrics', text: '95% Wilson confidence interval and on-time rate' },
      { id: 'data', text: 'Synthetic incident fields and codebook' },
    ]
    expect(findDocumentationSections('WILSON interval', sections)).toEqual(['metrics'])
    expect(findDocumentationSections('synthetic Wilson', sections)).toEqual([])
    expect(findDocumentationSections('   ', sections)).toEqual(['metrics', 'data'])
  })

  it('provides accessible navigation to every documented section', () => {
    const ids = ['overview', 'workflow', 'controls', 'metrics', 'data', 'methods', 'limitations', 'references']
    expect(html).toContain('aria-label="Documentation contents"')
    for (const id of ids) {
      expect(html).toContain(`href="#documentation-${id}"`)
      expect(html).toContain(`id="documentation-${id}"`)
    }
  })

  it('explains synthetic data, interpretations, assumptions, and limitations', () => {
    expect(html).toContain('The shipped incidents are synthetic')
    expect(html).toContain('95% Wilson confidence interval')
    expect(html).toContain('Insufficient baseline')
    expect(html).toContain('They do not establish why a delay occurred')
  })

  it('links readers to the codebook, API reference, and statistical specification', () => {
    expect(html).toContain('href="https://github.com/allyannap/sixsigma/blob/main/data/README.md"')
    expect(html).toContain('href="https://github.com/allyannap/sixsigma/blob/main/docs/api.md"')
    expect(html).toContain('href="https://github.com/allyannap/sixsigma/blob/main/SPEC.md"')
  })
})
