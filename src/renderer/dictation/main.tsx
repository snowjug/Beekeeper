import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';

// Placeholder: replaced by the dictation pill.
const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
createRoot(container).render(<StrictMode>{null}</StrictMode>);
