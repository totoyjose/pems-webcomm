import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// PERFORMANCE: Import icon fonts so they are bundled by Vite.
import 'bootstrap-icons/font/bootstrap-icons.css';
import "lineicons/dist/lineicons.css"; 
import 'bootstrap/dist/css/bootstrap.min.css';

// Import main stylesheet last to allow overriding library styles.
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)