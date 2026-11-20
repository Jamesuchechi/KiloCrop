import { render } from 'preact';

import { APP_BASE, appHref } from '../ui/base-url';
import { App } from './App';
import { initPwaLaunchConsumer } from './pwa-launch';
import './styles.css';

initPwaLaunchConsumer();
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(appHref('/sw.js'), { scope: APP_BASE }).catch(() => {
      // Service worker registration failure is non-fatal; app remains usable online.
    });
  });
}
