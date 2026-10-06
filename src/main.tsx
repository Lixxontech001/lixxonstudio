import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { NavigationProvider } from './context/NavigationContext';
import { initMonitoring, registerServiceWorker } from './lib/monitoring';
import { installChunkRecovery } from './lib/chunkRecovery';
import { installImageFallback } from './lib/images';
import { initReveal } from './lib/reveal';
import { handleServiceWorkerKillSwitch, initSwUpdate } from './lib/swUpdate';
import { applyPwaManifestForPath } from './lib/pwaManifest';

if (typeof window !== 'undefined') applyPwaManifestForPath(window.location.pathname);
initMonitoring();
const serviceWorkerResetRequested = handleServiceWorkerKillSwitch();
// Build-time emergency switch: set VITE_DISABLE_SW=1 to skip registration; leave it unset in Vercel.
if (!serviceWorkerResetRequested && import.meta.env.VITE_DISABLE_SW !== '1') {
  registerServiceWorker();
}
if (!serviceWorkerResetRequested) initSwUpdate();
installChunkRecovery();
installImageFallback();
initReveal();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationProvider>
      <App />
    </NavigationProvider>
  </StrictMode>
);
