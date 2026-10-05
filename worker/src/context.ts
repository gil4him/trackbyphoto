// Shared request types for the worker's request handlers.
//
// The old Cloud Function callables got the caller identity from the verified
// auth token. Here it comes from the requests/{id} doc, whose uid / email /
// name fields Firestore rules pin to request.auth.uid / token.email /
// token.name at create time (and clients can never update the doc afterward),
// so they're just as trustworthy.

export interface Caller {
  uid: string
  email: string | null
  name: string | null
}

/** Replacement for firebase-functions' HttpsError. The code strings keep the
 *  same vocabulary so the client can branch on them exactly as before. */
export class WorkerError extends Error {
  /** `details` travels back to the app with the error (e.g. which plan would fit). */
  constructor(public code: string, message: string, public details?: Record<string, unknown>) {
    super(message)
    this.name = 'WorkerError'
  }
}
