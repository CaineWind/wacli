import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
