import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aaacontracting.platform',
  appName: 'Nookleus',
  webDir: 'out',
  backgroundColor: '#0a0a0aff',
  server: {
    url: 'https://aaaplatform.vercel.app',
    cleartext: false,
    errorPath: 'index.html',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0a0a0aff',
  },
};

export default config;
