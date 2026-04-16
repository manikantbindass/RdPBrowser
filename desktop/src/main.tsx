import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Block right-click context menu (prevents inspect element)
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U (view source)
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
    (e.ctrlKey && e.key === 'U')
  ) {
    e.preventDefault();
    e.stopPropagation();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
