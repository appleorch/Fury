import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestPersistentStorage } from './lib/device';
import { dataStore } from './store/data';
import { recorder } from './store/recorder';
import './styles/app.css';

async function boot() {
  try {
    await dataStore.init();
    await recorder.init();
  } catch (e) {
    console.error('Failed to open local database', e);
  }
  void requestPersistentStorage();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
