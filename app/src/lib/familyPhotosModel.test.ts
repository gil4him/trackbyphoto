import { describe, it, expect } from 'vitest'
import { canSendFamilyPhoto, cardLine, sentStatus, sentToday, showable, viewerOrder } from './familyPhotosModel'
import type { FamilyPhoto } from '../types'

const p = (id: string, o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({
  id, patientUid: 'p1', senderUid: 'cg1', senderName: '민수', photoPath: `familyPhotos/p1/${id}.jpg`, photoUrl: 'https://x/' + id,
  caption: '보고 싶어요', status: 'ready', createdAtMs: Number(id), ...o,
})

describe('the card on the parent\'s home screen', () => {
  it('is absent until a photo is ready to show', () => {
    expect(cardLine([])).toBeNull()
    expect(cardLine([p('1', { status: 'pending', photoUrl: undefined })])).toBeNull()
  })
  it('names who sent what is new, lit', () => {
    expect(cardLine([p('1')])).toEqual({ line: '민수가 사진을 보냈어요', lit: true })
    expect(cardLine([p('1'), p('2')])).toEqual({ line: '민수가 사진 2장을 보냈어요', lit: true })
    expect(cardLine([p('1'), p('2', { senderName: '지은' }), p('3', { senderName: '지은' })])).toEqual({ line: '지은이 외 1명이 사진 3장을 보냈어요', lit: true })
  })
  it('stays quietly for the rest of the day once everything has been seen, then goes', () => {
    const now = new Date(2026, 9, 5, 15, 0).getTime()
    const earlierToday = new Date(2026, 9, 5, 9, 0).getTime()
    const yesterday = new Date(2026, 9, 4, 23, 0).getTime()
    expect(cardLine([p('1', { seenAtMs: 5, createdAtMs: earlierToday })], now)).toEqual({ line: '가족 사진 다시 보기', lit: false })
    expect(cardLine([p('1', { seenAtMs: 5, createdAtMs: yesterday })], now)).toBeNull()
  })
})

describe('what the viewer walks through', () => {
  it('new ones first, newest first within each, only ready ones', () => {
    const photos = [p('1', { seenAtMs: 9 }), p('3'), p('2'), p('4', { status: 'pending', photoUrl: undefined }), p('5', { seenAtMs: 9 })]
    expect(viewerOrder(photos).map((x) => x.id)).toEqual(['3', '2', '5', '1'])
    expect(showable(photos).map((x) => x.id)).toEqual(['5', '3', '2', '1'])
  })
})

describe('what the sender sees', () => {
  it('follows the photo from sending to the parent\'s answer', () => {
    expect(sentStatus(p('1', { status: 'pending' }))).toBe('보내는 중…')
    expect(sentStatus(p('1'))).toBe('보냈어요')
    expect(sentStatus(p('1', { seenAtMs: 2 }))).toBe('봤어요')
    expect(sentStatus(p('1', { seenAtMs: 2, reply: { kind: 'heart', atMs: 3 } }))).toBe('❤️ 고마워요')
    expect(sentStatus(p('1', { seenAtMs: 2, reply: { kind: 'comment', text: '고마워', atMs: 3 } }))).toBe('“고마워”')
  })
  it('counts only their own photos from today', () => {
    const now = new Date(2026, 9, 5, 15, 0).getTime()
    const yesterday = new Date(2026, 9, 4, 23, 0).getTime()
    const photos = [p('a', { createdAtMs: now - 1000 }), p('b', { createdAtMs: yesterday }), p('c', { createdAtMs: now - 500, senderUid: 'cg2' })]
    expect(sentToday(photos, 'cg1', now)).toBe(1)
  })
})

describe('who may send a parent photos', () => {
  it('follows the parent\'s setting and the sender\'s role, as the rules do', () => {
    expect(canSendFamilyPhoto(undefined, 'viewer')).toBe(true)
    expect(canSendFamilyPhoto({ enabled: false }, 'guardian')).toBe(false)
    expect(canSendFamilyPhoto({ senders: 'admins' }, 'viewer')).toBe(false)
    expect(canSendFamilyPhoto({ senders: 'admins' }, 'admin')).toBe(true)
    expect(canSendFamilyPhoto({ senders: 'admins' }, 'guardian')).toBe(true)
  })
})
