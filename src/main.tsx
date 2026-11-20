import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The UI's own weights; the type voices load theirs in voices.ts.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
