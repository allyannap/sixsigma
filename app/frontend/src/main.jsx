import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import 'maplibre-gl/dist/maplibre-gl.css'
import './tokens.css'
import './styles.css'
import './comparison.css'
import './trends.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
