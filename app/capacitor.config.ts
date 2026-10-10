import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zymer.daylie',
  appName: '오늘하루',
  webDir: 'dist',
  plugins: {
    // Native Google (and, on iPhone, Apple) sign-in; the ID token is handed to the Firebase JS
    // SDK (signInWithCredential), which stays the app's single auth state.
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com', 'apple.com'] },
    // Family push notifications: show them even while the app is open (iOS).
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
