// English for strings.ts. Typed as the Korean table, so a key missing here,
// or a function taking different arguments, fails the build.
import type { Strings } from './strings'

export const EN: Strings = {
  elderCardEmpty: 'No news from your family yet today',
  elderCardHeart: (name: string) => `${name} sent a heart`,
  elderCardComment: (name: string) => `${name} left a message`,
  elderReplyHeart: '❤️ Thank you',
  elderReplyVoice: '🎙️ Press and hold to speak',
  elderReplyText: 'Reply in writing',
  elderReplyTextTitle: 'What would you like to say?',
  elderReplyTextPlaceholder: 'Write what you want to say',
  elderReplyTypeOwn: '✏️ Write my own',
  elderReplyRecording: 'Let go to send',
  elderReplySent: (name: string) => `Sent ✓ We'll pass it to ${name}`,
  commentPlaceholder: 'Keep it short (60 characters)',
  voiceLocked: (patientName: string) => `Get replies in ${patientName}'s voice · Basic`,
  voicePending: 'Writing down the voice reply…',
  voiceNoTranscript: 'Nothing was written down. Tap to listen.',
  planTitle: 'A gift for your parent',
  planCurrent: 'Current plan',
  planMemoryStrip: (count: number, days: number | null) =>
    `${count} photo${count === 1 ? '' : 's'} kept${days == null ? '' : days <= 0 ? ' · the oldest is deleted soon' : ` · the oldest is deleted in ${days} day${days === 1 ? '' : 's'}`}`,
  planLimitFamily: (n: number, tier: string) =>
    `Up to ${n} family members can see the photos.${tier ? ` To invite more, you need ${tier}` : ''}`,
  planVoiceWaiting: (patientName: string, n: number) => `${n} ${n === 1 ? 'reply' : 'replies'} from ${patientName} ${n === 1 ? 'is' : 'are'} waiting`,
  planBeta: "It's a beta for now, so there is no charge.",
  planViewer: 'The main family member or a manager can change the plan.',
  voiceAlbum: 'Voice album',
  familyPhotoCardNew: (name: string, others: number, count: number) =>
    `${name}${others > 0 ? ` and ${others} other${others === 1 ? '' : 's'}` : ''} sent ${count > 1 ? `${count} photos` : 'a photo'}`,
  familyPhotoCardOld: 'See family photos again',
  familyPhotoFrom: (name: string) => `From ${name}`,
  familyPhotoLoadFail: "Couldn't load the photo",
  familyPhotoNext: 'Next photo ›',
  familyPhotoAllSeen: "You've seen them all ♥",
  familyPhotoToCamera: 'Back to start ›',
  familyPhotoSend: 'Send a photo',
  familyPhotoSendTitle: (name: string) => `Send a photo to ${name}`,
  familyPhotoCaption: 'A few words (optional)',
  familyPhotoSent: 'Photo sent',
  familyPhotoLimit: 'You can send up to 10 photos a day',
  familyPhotoSentList: 'Sent photos',
}

export const EN_FAMILY_PHOTO_CAPTIONS = ['Miss you', 'Here is my day', "We're doing well", 'Love you']

export const EN_QUICK_REPLIES = ["I'm fine", 'Thank you', 'I ate', "I'll call later", 'Love you']
