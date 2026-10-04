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
  elderReplyRecording: '손을 떼면 보내요',
  elderReplySent: (name: string) => `보냈어요 ✓ ${name}에게 전해드릴게요`,
  elderReading: '읽어 주는 중…',
  commentPlaceholder: '짧게 남겨 주세요 (60자)',
  voiceLocked: (patientName: string) => `${patientName} 목소리로 답장을 받아보세요 · Basic`,
  voicePending: '음성 답장을 받아쓰는 중…',
  voiceNoTranscript: '받아쓴 글이 없어요. 눌러서 들어 보세요.',
}
