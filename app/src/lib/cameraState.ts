/**
 * What the camera does when the app goes to the back or comes to the front.
 * The phone's own permission question takes the app "inactive" and back
 * while the camera is still starting underneath; reacting to that stopped
 * the camera the moment the parent tapped 허용 and then refused the second
 * start, so the screen said the camera was not allowed. While the phone is
 * asking, both events are ignored.
 */
export function appStateAction(isActive: boolean, phoneAsking: boolean, onCameraAsk: boolean): 'stop' | 'restart' | 'ignore' {
  if (phoneAsking) return 'ignore'
  if (!isActive) return 'stop'
  return onCameraAsk ? 'ignore' : 'restart'
}
