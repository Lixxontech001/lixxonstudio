import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { NavigationProvider } from './context/NavigationContext';
import { initMonitoring, registerServiceWorker } from './lib/monitoring';

initMonitoring();
registerServiceWorker();

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
);

let revealTimeout: ReturnType<typeof setTimeout> | null = null;
const observeReveals = () => {
  if (revealTimeout) clearTimeout(revealTimeout);
  revealTimeout = setTimeout(() => {
    document.querySelectorAll('.reveal:not(.revealed)').forEach(el => revealObserver.observe(el));
  }, 50);
};

const mo = new MutationObserver(observeReveals);
mo.observe(document.body, { childList: true, subtree: true });

setTimeout(() => { mo.disconnect(); }, 8000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationProvider>
      <App />
    </NavigationProvider>
  </StrictMode>
);
