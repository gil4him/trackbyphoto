import type { Timestamp } from 'firebase/firestore'

export type MemoCategory = '식사' | '산책' | '휴식' | '가족' | '일상'

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
}

export interface UserSettings {
  patientName: string
  recipients: { name: string; phone: string }[]
  cadence: 'realtime' | 'daily' | 'weekly'
  autoMode: boolean
  bigText: boolean
  retention: '30' | '90' | 'forever'
}
