import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// No StrictMode: its dev-only double mount unmounts drei <Html> label roots under React 19, dropping labels.
createRoot(document.getElementById('root')!).render(<App />);
