import { describe, it, expect } from 'vitest'
import { tabFromUrl } from './tabFromUrl'

describe('tabFromUrl', () => {
  it('reads a known tab from the query and ignores anything else', () => {
    expect(tabFromUrl({ search: '?tab=settings', pathname: '/' })).toBe('settings')
    expect(tabFromUrl({ search: '?tab=alerts&web=1', pathname: '/' })).toBe('alerts')
    expect(tabFromUrl({ search: '?tab=admin', pathname: '/' })).toBe('home')
    expect(tabFromUrl({ search: '', pathname: '/' })).toBe('home')
    expect(tabFromUrl(undefined)).toBe('home')
  })
})
