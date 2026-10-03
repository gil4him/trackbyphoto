import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gil4him.trackbyphoto',
  appName: '오늘하루',
  webDir: 'dist',
  plugins: {
    // Native Google sign-in only; the ID token is handed to the Firebase JS
    // SDK (signInWithCredential), which stays the app's single auth state.
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] },
  },
};

export default config;
