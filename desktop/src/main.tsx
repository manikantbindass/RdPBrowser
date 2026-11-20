import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Browser inspection controls are not an OS security boundary.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
