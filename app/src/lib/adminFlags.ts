// 운영실 기능 스위치 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D8): every rollout
// flag in admin_config/plans with its Korean name, which ones need a second
// look before they change, and the switch itself (worker adminSetFlag, which
// also writes admin_log). Kept in step with worker/src/plans.ts PLAN_FLAGS by
// a test.

import { callWorker } from './worker'

export interface FlagInfo {
  key: string
  name: string
  /** Shown under the name. */
  note?: string
  /** Risky: the page asks first, saying what will happen. */
  confirm?: { on: string; off: string }
}

export const FLAGS: FlagInfo[] = [
  { key: 'reactions', name: '하트·반응' },
  { key: 'familyPhotos', name: '가족 사진 보내기' },
  { key: 'pushFamily', name: '가족 푸시 알림' },
  { key: 'trailMap', name: '다녀온 곳 지도' },
  { key: 'memoV2', name: '메모 v2', note: '운영자가 v1 장면 메모를 원해 꺼 둔 기능이에요',
    confirm: { on: '메모가 v2 방식으로 써져요. 운영자가 v1 장면 메모를 원해서 꺼 둔 기능이에요 (10월 13일).', off: '메모가 v1 장면 메모로 돌아가요.' } },
  { key: 'memoWeather', name: '메모에 날씨' },
  { key: 'cloudMemo', name: '클라우드 AI 메모',
    confirm: { on: '새 사진의 메모를 클라우드 AI(Gemini)가 써요. 사진마다 비용이 들어요.', off: '새 사진의 메모를 Mac mini의 로컬 모델이 써요. 메모 말투가 달라질 수 있어요.' } },
  { key: 'usageCaps', name: '하루 AI 메모 한도',
    confirm: { on: '플랜의 하루 AI 메모 한도가 적용돼요. 한도를 넘은 사진은 간단한 메모만 받아요.', off: '하루 AI 메모 한도가 풀려서, 모든 사진이 AI 메모를 받아요.' } },
  { key: 'retentionJob', name: '보관 기간 정리',
    confirm: { on: '보관 기간이 지난 사진과 메모가 매일 지워져요. 지운 것은 되돌릴 수 없어요.', off: '오래된 사진과 메모를 더 지우지 않아요.' } },
  { key: 'planSheet', name: '플랜 안내 화면' },
  { key: 'digest', name: '하루 요약' },
  { key: 'emailDigest', name: '이메일 요약' },
  { key: 'messengerFree', name: '무료 메신저 요약' },
  { key: 'voiceReplies', name: '음성 답장' },
  { key: 'memoDiary', name: '메모 일기 모드', note: '비교 스크립트용이에요. 메모를 쓸 때는 쓰지 않아요' },
  { key: 'payments', name: '앱 결제',
    confirm: { on: '앱에서 실제 구독 결제를 받기 시작해요. 스토어 상품과 RevenueCat 설정이 끝났는지 먼저 확인해 주세요.', off: '앱에서 새 결제를 받지 않아요. 이미 낸 구독은 스토어에서 계속돼요.' } },
  { key: 'ceoMorningPush', name: '아침 8시 요약 푸시', note: '매일 8시(서울)에 어제 요약을 운영자 휴대폰으로 보내요' },
]

export const setFlag = (flag: string, on: boolean) =>
  callWorker<{ ok: true; flag: string; on: boolean; changed: boolean }>('adminSetFlag', { flag, on })

export interface FlagChange { flag: string; name: string; to: boolean; at: Date | null }

/** The newest flag changes from admin_log rows (any order in, newest first out). */
export function flagChanges(rows: { action: string; details: Record<string, unknown>; timestamp: { toDate: () => Date } | null }[], n = 10): FlagChange[] {
  return rows
    .filter((r) => r.action === 'flag.set' && typeof r.details?.flag === 'string')
    .map((r) => {
      const flag = String(r.details.flag)
      return { flag, name: FLAGS.find((f) => f.key === flag)?.name ?? flag, to: r.details.to === true, at: r.timestamp?.toDate() ?? null }
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, n)
}
