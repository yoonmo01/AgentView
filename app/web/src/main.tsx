import { createRoot } from 'react-dom/client';
import { Admin } from './admin/Admin.tsx';
import App from './App.tsx';
import { Chat } from './chat/Chat.tsx';
import './index.css';

// ponytail: three pages, so a pathname switch instead of a router library
const pages = [
  { path: '/', label: '오피스', el: <App /> },
  { path: '/chat', label: '채팅', el: <Chat /> },
  { path: '/admin', label: '관리', el: <Admin /> },
];
const page = pages.find((p) => p.path === location.pathname) ?? pages[0];

// No StrictMode: its dev-only double mount unmounts drei <Html> label roots under React 19, dropping labels.
createRoot(document.getElementById('root')!).render(
  <>
    <nav className="nav">
      <b>AgentView</b>
      {pages.map((p) => <a key={p.path} href={p.path} aria-current={p === page ? 'page' : undefined}>{p.label}</a>)}
    </nav>
    {page.el}
  </>,
);
