// 운영실 시스템: the worker's short memory — beats, memo times, percentiles and
// the 60-minute strip — and that a heartbeat and a ready memo feed it.

import { describe, it, expect, beforeEach } from 'vitest'
import { beatCells, history, memoStats, percentile, recordBeat, recordMemoTime, resetSystemHistory } from '../src/systemHistory'
import { beat } from '../src/heartbeat'
import { clearFirestore } from './setup'

const M = 60_000
const NOW = Date.parse('2026-10-24T03:00:00Z')

beforeEach(() => resetSystemHistory())

describe('percentiles and memo times', () => {
  it('takes the nearest rank, and nothing from nothing', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50)
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90)
  })

  it('keeps the last 500 memo times and ignores nonsense', () => {
    for (let i = 0; i < 520; i++) recordMemoTime(NOW - 1000 * (i + 1), NOW)
    recordMemoTime(null, NOW)
    recordMemoTime(NOW + 5000, NOW) // ready before it was made: a clock skew
    expect(history().memoTimes).toHaveLength(500)
  })

  it('the last 15 minutes needs three memos before it says anything', () => {
    const times = [{ at: NOW - 20 * M, ms: 90_000 }, { at: NOW - M, ms: 40_000 }, { at: NOW - 2 * M, ms: 50_000 }]
    expect(memoStats(times, NOW)).toMatchObject({ p50: 50_000, p90: 90_000, count: 3, p50Last15: null })
    expect(memoStats([...times, { at: NOW, ms: 45_000 }], NOW).p50Last15).toBe(45_000)
  })
})

describe('the 60-minute strip', () => {
  it('ok, slow (model down or 5+ waiting), missed, and nothing before the worker started', () => {
    const started = NOW - 30 * M
    const list = [
      { at: NOW - 29.5 * M, modelUp: true, waiting: 0 },
      { at: NOW - 28.5 * M, modelUp: false, waiting: 0 },
      { at: NOW - 27.5 * M, modelUp: true, waiting: 6 },
      { at: NOW - 0.5 * M, modelUp: true, waiting: 1 },
    ]
    const cells = beatCells(list, NOW, started)
    expect(cells).toHaveLength(60)
    expect(cells.slice(0, 30).every((c) => c === 'none')).toBe(true)
    expect(cells.slice(30, 33)).toEqual(['ok', 'slow', 'slow'])
    expect(cells[33]).toBe('miss')
    expect(cells[59]).toBe('ok')
  })
})

describe('feeding it', () => {
  it('a heartbeat is remembered after it is written', async () => {
    await clearFirestore()
    await beat({ modelUp: async () => true, waiting: () => 2 })
    expect(history().beats).toHaveLength(1)
    expect(history().beats[0]).toMatchObject({ modelUp: true, waiting: 2 })
    for (let i = 0; i < 70; i++) recordBeat({ at: i, modelUp: true, waiting: 0 })
    expect(history().beats).toHaveLength(60)
  })
})
