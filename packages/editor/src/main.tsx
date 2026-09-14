/** The app entry point: the editor, full screen. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QuestEditor } from './components/QuestEditor'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('no #root element to mount into')

createRoot(root).render(
  <StrictMode>
    <QuestEditor />
  </StrictMode>,
)
