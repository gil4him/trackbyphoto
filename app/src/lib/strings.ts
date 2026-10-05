// UI strings for v2 (docs/DAYLIE_V2_BUILD.md, Appendix A), easy 존댓말.
// "어머니" in the guide is the patient's display name here.

/** Subject particle: 민수가 / 지은이. */
export function subject(name: string): string {
  const last = name.trim().slice(-1)
  const code = last.charCodeAt(0)
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0
  return `${name.trim()}${hasFinal ? '이' : '가'}`
}

export const S = {
  elderCardEmpty: '오늘 가족 소식이 아직 없어요',
  elderCardHeart: (name: string) => `${subject(name)} 하트를 보냈어요`,
  elderCardComment: (name: string) => `${subject(name)} 글을 남겼어요`,
  elderReplyHeart: '❤️ 고마워요',
  elderReplyVoice: '🎙️ 꾹 누르고 말하기',
  elderReplyText: '글로 답장하기',
  elderReplyTextTitle: '무엇이라고 답할까요?',
  elderReplyTextPlaceholder: '직접 써도 돼요',
  elderReplyRecording: '손을 떼면 보내요',
  elderReplySent: (name: string) => `보냈어요 ✓ ${name}에게 전해드릴게요`,
  elderReading: '읽어 주는 중…',
  commentPlaceholder: '짧게 남겨 주세요 (60자)',
  voiceLocked: (patientName: string) => `${patientName} 목소리로 답장을 받아보세요 · Basic`,
  voicePending: '음성 답장을 받아쓰는 중…',
  voiceNoTranscript: '받아쓴 글이 없어요. 눌러서 들어 보세요.',
  planTitle: '부모님께 드리는 선물',
  planCurrent: '지금 요금제',
  /** "보관 중인 사진 312장 · 가장 오래된 사진 6일 뒤 삭제"; without `days` only the first half. */
  planMemoryStrip: (count: number, days: number | null) =>
    `보관 중인 사진 ${count}장${days == null ? '' : days <= 0 ? ' · 가장 오래된 사진 곧 삭제' : ` · 가장 오래된 사진 ${days}일 뒤 삭제`}`,
  /** `tier` comes with its particle ("Basic이"); empty when no plan has more room. */
  planLimitFamily: (n: number, tier: string) =>
    `가족 ${n}명까지 함께 볼 수 있어요.${tier ? ` 더 초대하려면 ${tier} 필요해요` : ''}`,
  planVoiceWaiting: (patientName: string, n: number) => `${subject(patientName)} 남긴 답장 ${n}개가 기다리고 있어요`,
  planBeta: '지금은 베타 기간이라 요금이 청구되지 않아요.',
  planViewer: '요금제는 대표 가족이나 관리자가 바꿀 수 있어요.',
  voiceAlbum: '목소리 앨범',
}

/** One-tap answers on the parent's 글로 답장하기 screen, in a parent's own voice. */
export const QUICK_REPLIES = ['잘 지내', '고마워', '밥 먹었어', '나중에 전화할게', '사랑해']
