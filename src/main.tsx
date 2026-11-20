import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// StrictMode is intentionally not used here. Its development-only double mount
// makes @react-three/fiber create a second WebGL renderer on the same canvas,
// which fails with "Canvas has an existing context of a different type" and
// freezes the heart scene after a single frame. See docs/DECISIONS.md (D-13).
createRoot(container).render(<App />);
