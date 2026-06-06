import { registerPlugin } from '@capacitor/core'

import type { OnDeviceVisionPlugin } from './definitions'

const OnDeviceVision = registerPlugin<OnDeviceVisionPlugin>('OnDeviceVision', {
  web: () => import('./web').then((m) => new m.OnDeviceVisionWeb()),
})

export * from './definitions'
export { OnDeviceVision }
