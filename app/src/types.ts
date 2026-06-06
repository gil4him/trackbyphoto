import type { Timestamp } from 'firebase/firestore'

export type MemoCategory = '식사' | '산책' | '휴식' | '가족' | '일상'

/** On-device Apple Vision tags attached to a memo. */
export interface MemoVisionTags {
  labels: { name: string; confidence: number }[]
  text: string[]
  faceCount: number
}

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
  category: MemoCategory
  status: 'pending' | 'ready' | 'error'
  createdAt: Timestamp
  /** Present when the photo was captured on a native iOS device. */
  tags?: MemoVisionTags
}

export interface UserSettings {
  patientName: string
  recipients: { name: string; phone: string }[]
  cadence: 'realtime' | 'daily' | 'weekly'
  autoMode: boolean
  bigText: boolean
  retention: '30' | '90' | 'forever'
}
