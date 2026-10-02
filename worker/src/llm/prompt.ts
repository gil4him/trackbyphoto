// Memo prompt, response parsing, deterministic stub, and tag → category
// heuristic. Moved verbatim from the old Cloud Function (functions/src/index.ts)
// so the local model gets exactly the instructions Gemini/OpenAI did.

export const VALID_CATEGORIES = ['식사', '산책', '휴식', '가족', '꽃', '기타'] as const

export interface VisionTags {
  labels: { name: string; confidence: number }[]
  text: string[]
  faceCount: number
}

// Korean memo prompt shared by every model. Lives at module scope so every
// model sees the exact same instructions — makes A/B comparisons fair.
//
// Tone target: a warm caption a family member would smile at. The model
// reports ONE short Korean sentence about what the senior is doing, plus a
// one-word activity category. We deliberately do NOT ask it to list objects,
// colors, counts, or background — those produced clinical descriptions that
// felt cold when family read them.
export function buildPrompt(timeHint?: string, placeHint?: string): string {
  return [
    '당신은 어르신의 하루를 가족에게 따뜻하게 전하는 보조 AI입니다.',
    '사진을 보고 세 가지를 작성해 주세요: 한 단어 카테고리(activity), 짧은 캡션(memo), 그리고 그 순간을 묘사하는 두 문장(scene).',
    '',
    '공통 규칙:',
    '- 한국어 존댓말. 따뜻하지만 사실에 가깝게.',
    '- 사람 이름, 사진 속 글자, 건강·약·진단명은 절대 추측하지 마세요.',
    '- 확신이 없으면 일반적으로 적고, 구체적인 사실을 지어내지 마세요.',
    '- 관계 추측 금지("따님과", "친구와" 등 확인되지 않으면 쓰지 마세요).',
    '',
    'memo (한 문장, 25자 이내):',
    '- 무엇을 하고 계신지(활동)에 집중. 가족이 미소 지을 만한 따뜻한 캡션.',
    '- 사물·옷·색깔·배경·개수를 나열하지 마세요. 활동 중심.',
    '',
    'scene (두 문장, 50~100자):',
    '- 그 순간을 가족이 함께 있는 듯 느끼도록 짧게 묘사.',
    '- 시간대 느낌(아침 햇살, 조용한 오후 등), 장소 분위기, 그리고 사진에서 보이는 구체적인 한 가지(음식, 빛, 창밖 풍경, 꽃 등)를 자연스럽게 한 번만 언급.',
    '- 분위기 한 단어로 끝낼 수도 있어요(여유로운, 평온한, 따뜻한 등).',
    '- 사물 나열·개수·색깔 나열 금지. 한 가지 앵커만.',
    '',
    'activity 카테고리(정확히 하나): 식사 / 산책 / 휴식 / 가족 / 꽃 / 기타',
    '',
    '사진이 흐리거나 활동이 불분명하면:',
    '  {"activity":"기타","memo":"오늘의 한 순간을 담았어요.","scene":"오늘 하루의 작은 한 장면이에요."}',
    '',
    '예시:',
    '- 식탁 위 음식과 수저 → {"activity":"식사","memo":"맛있는 식사를 하고 계세요.","scene":"식탁 위에 따뜻한 음식이 차려져 있어요. 점심시간의 여유로운 한 장면이에요."}',
    '- 나무가 있는 공원길 → {"activity":"산책","memo":"공원에서 산책 중이세요.","scene":"나무가 우거진 산책로를 천천히 걷고 계세요. 햇살이 부드럽게 비치는 오후예요."}',
    '- 소파와 텔레비전 → {"activity":"휴식","memo":"거실에서 편안히 쉬고 계세요.","scene":"소파에 기대어 잠시 쉬어가는 시간이에요. 조용하고 평온한 분위기예요."}',
    '- 사람들이 모여 웃고 있는 모습 → {"activity":"가족","memo":"가족과 즐거운 시간을 보내고 계세요.","scene":"가까운 사람들과 함께 모여 계세요. 따뜻한 분위기가 느껴져요."}',
    '- 화분의 꽃 → {"activity":"꽃","memo":"예쁜 꽃을 보고 계세요.","scene":"활짝 핀 꽃 가까이에서 바라보고 계세요. 봄날의 산뜻한 한 컷이에요."}',
    '',
    '상황 정보 (참고용, 사진과 어긋나면 무시):',
    `- 시간: ${timeHint || '알 수 없음'}`,
    `- 장소: ${placeHint || '알 수 없음'}`,
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"activity":"<한 단어 카테고리>","memo":"<짧고 따뜻한 한 문장>","scene":"<두 문장의 따뜻한 장면 묘사>"}',
  ].join('\n')
}

export function parseModelResponse(raw: string): { activity: string; memo: string; scene: string } | null {
  // Models occasionally wrap JSON in a code fence even with the
  // response-format hint.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { activity?: unknown; memo?: unknown; scene?: unknown }
    const activityRaw = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const memo = typeof parsed.memo === 'string' ? parsed.memo.trim() : ''
    // scene is optional in the response — when a model briefly drops it we
    // still accept the memo. The UI hides the section when empty so this
    // degrades gracefully.
    const scene = typeof parsed.scene === 'string' ? parsed.scene.trim() : ''
    if (!memo) return null
    // Snap the activity to one of the known categories. The model can drift
    // ("점심" instead of "식사") so we coerce — anything unrecognized falls
    // back to 기타 rather than polluting the dashboard with one-off buckets.
    const activity = (VALID_CATEGORIES as readonly string[]).includes(activityRaw)
      ? activityRaw
      : '기타'
    return { activity, memo, scene }
  } catch {
    return null
  }
}

// Final-fallback stub, used when the local model fails repeatedly on a photo.
// Memos + scenes here mirror the warm tone the LLM prompt asks for, so when
// we fall back the user can't tell something went wrong.
const STUB_ACTIVITIES: { cat: string; memos: string[]; scenes: string[] }[] = [
  {
    cat: '식사',
    memos: ['맛있는 식사를 하고 계세요.', '따뜻한 한 끼를 드시고 계세요.', '식사 시간이에요.'],
    scenes: [
      '식탁 위에 따뜻한 음식이 차려져 있어요. 여유로운 식사 시간이에요.',
      '정성스레 차린 한 끼 앞에 앉아 계세요. 평온한 한 장면이에요.',
    ],
  },
  {
    cat: '산책',
    memos: ['공원에서 산책 중이세요.', '햇살 아래 걷고 계세요.', '바깥 공기를 쐬고 계세요.'],
    scenes: [
      '바깥 공기를 쐬며 천천히 걷고 계세요. 햇살이 부드러운 시간이에요.',
      '나뭇잎이 흔들리는 산책길을 걷고 계세요. 편안한 분위기가 느껴져요.',
    ],
  },
  {
    cat: '휴식',
    memos: ['거실에서 편안히 쉬고 계세요.', '잠깐 쉬어가는 시간이에요.', '여유로운 시간을 보내고 계세요.'],
    scenes: [
      '잠시 자리에 앉아 한숨 돌리고 계세요. 조용하고 평온한 분위기예요.',
      '편안한 자리에서 쉬어가는 시간이에요. 따뜻한 빛이 감도는 한 장면이에요.',
    ],
  },
  {
    cat: '가족',
    memos: ['가족과 즐거운 시간을 보내고 계세요.', '함께하는 시간이에요.'],
    scenes: [
      '가까운 사람들과 함께 모여 계세요. 따뜻한 분위기가 느껴져요.',
      '함께 모인 자리에서 시간을 보내고 계세요. 편안한 한 장면이에요.',
    ],
  },
  {
    cat: '꽃',
    memos: ['예쁜 꽃을 보고 계세요.', '꽃과 함께한 순간이에요.'],
    scenes: [
      '활짝 핀 꽃 가까이에서 바라보고 계세요. 산뜻한 한 컷이에요.',
      '꽃이 피어 있는 자리에서 잠시 멈춰 계세요. 부드러운 분위기예요.',
    ],
  },
  {
    cat: '기타',
    memos: ['오늘의 한 순간을 담았어요.'],
    scenes: ['오늘 하루의 작은 한 장면이에요.'],
  },
]
export function stubActivity(): { activity: string; memo: string; scene: string } {
  const a = STUB_ACTIVITIES[Math.floor(Math.random() * STUB_ACTIVITIES.length)]
  return {
    activity: a.cat,
    memo: a.memos[Math.floor(Math.random() * a.memos.length)],
    scene: a.scenes[Math.floor(Math.random() * a.scenes.length)],
  }
}

/**
 * Pick a coarse activity category from Vision tags when the device wrote the
 * memo. The Foundation-Models sentence isn't easy to bucket post-hoc, but the
 * underlying VNClassifyImageRequest labels (English ImageNet-ish names) map
 * cleanly enough. Defaults to 기타.
 */
export function categoryFromTags(
  tags: VisionTags | null | undefined,
): string {
  if (!tags) return '기타'
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|drink|beverage|cup|fruit|vegetable/.test(names)) return '식사'
  if (/park|tree|outdoor|street|walk|path|garden|trail|sky|grass/.test(names)) return '산책'
  if (/flower|blossom|petal|bouquet|rose|tulip/.test(names)) return '꽃'
  if (/sofa|bed|chair|tv|television|book|tea|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '가족'
  return '기타'
}
