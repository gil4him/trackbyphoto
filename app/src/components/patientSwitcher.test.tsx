// The account bar: an avatar + name chip; 내 계정으로 only on someone else's page.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { PatientSwitcher } from './PatientSwitcher'
import type { Person } from '../lib/people'
import type { LiveMembership } from '../hooks/useMemberships'

const people = [{ patientUid: 'p1', name: '할아버지', membership: { role: 'admin' } }] as unknown as Person<LiveMembership>[]
const render = (active: string) =>
  renderToString(<PatientSwitcher selfUid="me" selfLabel="Shawn" people={people} activePatientUid={active} onChange={() => {}} />).replace(/<!-- -->/g, '')

describe('PatientSwitcher', () => {
  it('own page: avatar and name, no extra 내 계정 label', () => {
    const html = render('me')
    expect(html).toContain('<span class="acct-avatar" aria-hidden="true">S</span>')
    expect(html).toContain('Shawn')
    expect(html).not.toContain('내 계정')
  })

  it('a parent\'s page: blue avatar, 님, and the way back', () => {
    const html = render('p1')
    expect(html).toContain('acct-bar caregiver')
    expect(html).toContain('<span class="acct-avatar parent" aria-hidden="true">할</span>')
    expect(html).toContain('할아버지님')
    expect(html).toContain('내 계정으로')
  })

  it('nobody to switch to: nothing', () => {
    expect(renderToString(<PatientSwitcher selfUid="me" selfLabel="Shawn" people={[]} activePatientUid="me" onChange={() => {}} />)).toBe('')
  })
})
