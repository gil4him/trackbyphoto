import { isSimple } from './edition'
import type { TextReplies } from '../types'

/** Written replies for a parent whose family never chose: the simple edition
 *  starts with one-tap phrases and no keyboard; the full edition with typing. */
export const defaultTextReplies = (): TextReplies => (isSimple() ? 'quick' : 'full')
