import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { NavigationProvider } from './context/NavigationContext';
import { initMonitoring, registerServiceWorker } from './lib/monitoring';
import { installChunkRecovery } from './lib/chunkRecovery';
import { installImageFallback } from './lib/images';
import { initReveal } from './lib/reveal';

initMonitoring();
registerServiceWorker();
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
