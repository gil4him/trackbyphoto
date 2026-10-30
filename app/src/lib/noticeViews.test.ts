// Which unread notices looking at something counts as seen (the icon badge).
import { describe, it, expect } from 'vitest'
import { noticesSeen } from './noticeViews'
import type { AppNotification } from '../types'

const n = (id: string, type: string, over: Partial<AppNotification> = {}) =>
  ({ id, type, patientUid: 'mom', recipientUid: 'me', actorUid: '', message: '', read: false, ...over }) as AppNotification

const all = [
  n('photo1', 'photo.new', { memoId: 'm1' }),
  n('photo2', 'photo.new', { memoId: 'm2' }),
  n('reply1', 'reaction.comment', { memoId: 'm1' }),
  n('dadPhoto', 'photo.new', { patientUid: 'dad', memoId: 'm1' }),
  n('fpReply', 'familyPhoto.reply'),
  n('evening', 'daily.photos'),
  n('digest', 'digest.ready', { digestId: 'd1' }),
  n('old', 'photo.new', { memoId: 'm1', read: true }),
]

describe('noticesSeen', () => {
  it('a photo: its new-photo notice and the parent\'s replies on it, for that parent only', () => {
    expect(noticesSeen({ kind: 'memo', patientUid: 'mom', memoId: 'm1' }, all)).toEqual(['photo1', 'reply1'])
  })
  it('a parent\'s home: their answers to photos you sent', () => {
    expect(noticesSeen({ kind: 'home', patientUid: 'mom' }, all)).toEqual(['fpReply'])
    expect(noticesSeen({ kind: 'home', patientUid: 'dad' }, all)).toEqual([])
  })
  it('a parent\'s 사진 tab: the evening photo count', () => {
    expect(noticesSeen({ kind: 'today', patientUid: 'mom' }, all)).toEqual(['evening'])
  })
  it('a parent\'s day: what is already on it, for that parent only', () => {
    expect(noticesSeen({ kind: 'day', patientUid: 'mom' }, [...all, n('none', 'daily.no_photo')])).toEqual(['photo1', 'photo2', 'fpReply', 'evening'])
    expect(noticesSeen({ kind: 'day', patientUid: 'dad' }, all)).toEqual(['dadPhoto'])
  })
  it('a digest: its own notice', () => {
    expect(noticesSeen({ kind: 'digest', digestId: 'd1' }, all)).toEqual(['digest'])
  })
  it('anything else clears nothing', () => {
    expect(noticesSeen({ kind: 'other' }, all)).toEqual([])
  })
})
