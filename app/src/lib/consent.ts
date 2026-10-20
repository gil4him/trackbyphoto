// The simple edition's consent wording (simple/Daylie-v3-Simple-Core.md §5).
// The family consents on the parent's behalf when registering
// (RegisterElder); the parent's phone shows one screen once it is linked
// (SimpleConsent) and its 네 is kept as a notice_ack with this exact text.

import { tr } from './lang'

/** Stored with every simple-edition consent record. */
export const SIMPLE_CONSENT_VERSION = 'simple-v1'

export const SIMPLE_CONSENT_TITLE = tr('가족에게 오늘 하루를 보여드릴까요?', 'Shall we show your family how your day went?')

/** What the parent agrees to, naming who will see it ("가족" if unknown). */
export function simpleConsentText(name: string): string {
  return tr(`내가 찍은 사진과 찍은 곳을 ${name}에게 보여드려요.`, `${name} will see the photos you take and where you took them.`)
}

/** 자세한 내용 보기 on the parent's screen. */
export const SIMPLE_CONSENT_DETAILS = [
  tr('찍은 사진과 찍은 시간, 찍은 곳의 이름을 저장해요.', 'Each photo is saved with the time and the name of the place.'),
  tr('사진마다 짧은 설명이 자동으로 만들어져요.', 'A short note is written for each photo automatically.'),
  tr('연결된 가족만 볼 수 있어요.', 'Only your connected family can see them.'),
  tr('가족 휴대폰에서 언제든 연결을 끊을 수 있어요.', "Your family can disconnect this phone at any time from theirs."),
]

/** The family's consent on the parent's behalf (no voice replies here). */
export function simpleGuardianConsent(name: string): string[] {
  return [
    tr(`${name}님이 찍은 사진과 자동으로 작성된 메모(시간·장소 이름)를 저장하고 처리해요.`, `Daylie saves and processes the photos ${name} takes and the notes written for them automatically (time and place name).`),
    tr(`그 사진과 메모를 연결된 가족에게 보여줘요.`, 'It shows those photos and notes to the connected family.'),
  ]
}
