import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeAnalytics, trackError } from './analytics';

initializeAnalytics();
window.addEventListener('error', (event) => trackError('window', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => trackError('promise', event.reason));

// A tab opened before a deploy asks for chunks that no longer exist; reload once to get the new build.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'mitospace.chunkReloadAt';
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
