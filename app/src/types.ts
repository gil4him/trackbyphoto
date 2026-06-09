import type { Timestamp } from 'firebase/firestore'

export type MemoCategory = '식사' | '산책' | '휴식' | '가족' | '일상'

/** On-device Apple Vision tags attached to a memo. */
export interface MemoVisionTags {
  labels: { name: string; confidence: number }[]
  text: string[]
  faceCount: number
}

/** Which tier produced the activity text. Drives the AI badge on the detail page. */
export type MemoSource =
  | 'foundation-models' // iOS 26+ Apple Intelligence on-device LLM
  | 'template'          // pre-iOS-26: Korean sentence template over Vision tags
  | 'cloud-vision'      // Gemini 2.0 Flash Vision (web upload / older iPhone)
  | 'cloud-stub'        // final fallback when Gemini is unreachable
  | 'human'             // guardian hand-edited the activity

export interface Memo {
  id: string
  uid: string
  photoPath: string        // gs path: photos/{uid}/{photoId}.jpg
  photoUrl: string         // public download URL
  takenAt: Timestamp
  lat: number | null
  lng: number | null
  place: string
  activity: string
  /** Longer 1–3 sentence Korean description of what's in the photo. Cloud
   *  Vision tier (Gemini) and stub fill this; the on-device path leaves it
   *  empty until we add a details prompt to Foundation Models. */
  details?: string
  category: MemoCategory
  status: 'pending' | 'ready' | 'error'
  createdAt: Timestamp
  /** Present when the photo was captured on a native iOS device. */
  tags?: MemoVisionTags
  /** Which tier produced the activity — useful for the AI source badge. */
  memoSource?: MemoSource
  /** True once a guardian has hand-edited the activity. Blocks the function
   *  from ever overwriting the text on retrigger/regenerate. */
  humanEdited?: boolean
}

export interface UserSettings {
  patientName: string
  recipients: { name: string; phone: string }[]
  cadence: 'realtime' | 'daily' | 'weekly'
  autoMode: boolean
  bigText: boolean
  retention: '30' | '90' | 'forever'
}
