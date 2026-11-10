import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNative } from './platform/output';
import './styles.css';

// Offline support on the web: the service worker precaches the whole app (incl. pdf.js worker).
// Inside the native shell assets are already local, so no service worker is registered there.
if (!isNative() && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
