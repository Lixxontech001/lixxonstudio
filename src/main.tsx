import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { NavigationProvider } from './context/NavigationContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationProvider>
      <App />
    </NavigationProvider>
  </StrictMode>
);
