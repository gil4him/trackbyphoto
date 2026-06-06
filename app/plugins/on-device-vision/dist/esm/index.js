import { registerPlugin } from '@capacitor/core';
const OnDeviceVision = registerPlugin('OnDeviceVision', {
    web: () => import('./web').then((m) => new m.OnDeviceVisionWeb()),
});
export * from './definitions';
export { OnDeviceVision };
