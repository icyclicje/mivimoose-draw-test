import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, loadTheme } from './lib/themes';
import './styles/themes.css';
import './styles/global.css';

// Before the first paint, so a light theme never flashes dark on reload.
applyTheme(loadTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
