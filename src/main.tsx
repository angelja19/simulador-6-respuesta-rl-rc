import React from 'react';
import { createRoot } from 'react-dom/client';
import './core/ui/styles.css';
import { ThemeProvider } from './core/ui/basic';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
