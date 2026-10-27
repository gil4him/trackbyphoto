import { honorificWith } from './people'
// The simple edition's consent wording (simple/Daylie-v3-Simple-Core.md §5).
// The family consents on the parent's behalf when registering
// (RegisterElder); the parent's phone shows one screen once it is linked
// (SimpleConsent) and its 네 is kept as a notice_ack with this exact text.

/** Stored with every simple-edition consent record. */
/** simple-v2 (2026-10-27): names Google's AI (Gemini) as the memo writer. */
export const SIMPLE_CONSENT_VERSION = 'simple-v2'

export const SIMPLE_CONSENT_TITLE = '가족에게 오늘 하루를 보여드릴까요?'

/** What the parent agrees to, naming who will see it ("가족" if unknown). */
export function simpleConsentText(name: string): string {
  return `내가 찍은 사진과 찍은 곳을 ${name}에게 보여드려요.`
}

/** Shown under the sentence, always (Apple 5.1.2(i): sharing with a third-party AI). */
export const SIMPLE_CONSENT_AI = '사진 설명은 Google의 AI가 써요. 사진이 Google에 전달되지만, AI 학습에는 쓰이지 않아요.'

/** 자세한 내용 보기 on the parent's screen. */
export const SIMPLE_CONSENT_DETAILS = [
  '찍은 사진과 찍은 시간, 찍은 곳의 이름을 저장해요.',
  '사진마다 짧은 설명을 Google의 AI(Gemini)가 자동으로 써요.',
  '연결된 가족만 볼 수 있어요.',
  '가족 휴대폰에서 언제든 연결을 끊을 수 있어요.',
]

/** The family's consent on the parent's behalf (no voice replies here). */
export function simpleGuardianConsent(name: string): string[] {
  return [
    `${honorificWith(name, '가')} 찍은 사진과 자동으로 작성된 메모(시간·장소 이름)를 저장하고 처리해요.`,
    `메모를 쓰기 위해 사진과 찍은 시각·장소가 Google의 AI(Gemini)에 전달돼요. AI 학습에는 쓰이지 않아요.`,
    `그 사진과 메모를 연결된 가족에게 보여줘요.`,
  ]
}
