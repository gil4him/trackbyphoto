// Which consent version and voice consent each edition registers a parent with.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const edition = vi.hoisted(() => ({ simple: false }))
vi.mock('./edition', () => ({ isSimple: () => edition.simple }))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { managedConsent, MANAGED_CONSENT_VERSION } from './pairing'
import { SIMPLE_CONSENT_AI, SIMPLE_CONSENT_DETAILS, SIMPLE_CONSENT_VERSION, simpleGuardianConsent } from './consent'

describe('managedConsent', () => {
  beforeEach(() => { edition.simple = false })

  it('full: managed-v2 with voice replies', () => {
    expect(managedConsent()).toEqual({ consentTextVersion: MANAGED_CONSENT_VERSION, voiceConsent: true })
  })

  it('simple: simple-v2, no voice replies', () => {
    edition.simple = true
    expect(managedConsent()).toEqual({ consentTextVersion: SIMPLE_CONSENT_VERSION, voiceConsent: false })
  })

  it('the simple family consent never mentions voice', () => {
    expect(simpleGuardianConsent('엄마').join(' ')).not.toMatch(/음성|녹음/)
  })

  it('the simple consents name Google\'s AI as the memo writer (Apple 5.1.2(i))', () => {
    expect(simpleGuardianConsent('엄마').join(' ')).toContain('Google의 AI')
    expect(SIMPLE_CONSENT_AI).toContain('Google')
    expect(SIMPLE_CONSENT_DETAILS.join(' ')).toContain('Google의 AI')
  })
})
