// The simple edition's consent wording (docs/Daylie-v3-Simple-Core.md §5).
// The family consents on the parent's behalf when registering
// (RegisterElder); the parent's phone shows one screen once it is linked
// (SimpleConsent) and its 네 is kept as a notice_ack with this exact text.

/** Stored with every simple-edition consent record. */
export const SIMPLE_CONSENT_VERSION = 'simple-v1'

export const SIMPLE_CONSENT_TITLE = '가족에게 오늘 하루를 보여드릴까요?'

/** What the parent agrees to, naming who will see it ("가족" if unknown). */
export function simpleConsentText(name: string): string {
  return `내가 찍은 사진과 찍은 곳을 ${name}에게 보여드려요.`
}

/** 자세한 내용 보기 on the parent's screen. */
export const SIMPLE_CONSENT_DETAILS = [
  '찍은 사진과 찍은 시간, 찍은 곳의 이름을 저장해요.',
  '사진마다 짧은 설명이 자동으로 만들어져요.',
  '연결된 가족만 볼 수 있어요.',
  '가족 휴대폰에서 언제든 연결을 끊을 수 있어요.',
]

/** The family's consent on the parent's behalf (no voice replies here). */
export function simpleGuardianConsent(name: string): string[] {
  return [
    `${name}님이 찍은 사진과 자동으로 작성된 메모(시간·장소 이름)를 저장하고 처리해요.`,
    `그 사진과 메모를 연결된 가족에게 보여줘요.`,
  ]
}
