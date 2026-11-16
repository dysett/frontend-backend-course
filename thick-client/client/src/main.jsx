import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import Catalog from './catalog';
import Admin from './admin';
import { Icon, Notice } from './components';
import { useLibrary } from './use-library';
import { api } from './api';

function App() {
  const library = useLibrary();
  const isAdmin = window.location.pathname === '/admin';
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true); setError('');
    try { await api('/auth/logout', { method: 'POST', body: {} }); library.setUser(null); await library.refresh(true); }
    catch (e) { setError(e.message); } finally { setLoggingOut(false); }
  }
  return <div className="app-shell"><a className="skip-link" href="#main-content">Перейти до вмісту</a><header className="site-header"><div className="container header-inner"><a className="brand" href="/" aria-label="Книгосховище — головна"><span className="brand-mark"><Icon name="book" /></span><span>книгосховище<small>БІБЛІОТЕКА ОНЛАЙН</small></span></a><nav className="header-nav" aria-label="Головна навігація"><a href="/" className={!isAdmin ? 'active' : ''} aria-current={!isAdmin ? 'page' : undefined}>Каталог</a><a href="/admin" className={isAdmin ? 'active' : ''} aria-current={isAdmin ? 'page' : undefined}><Icon name="grid-1x2" /><span>Адміністратор</span></a>{library.user && <button className="btn btn-sm btn-outline-primary" disabled={loggingOut} onClick={logout}><Icon name="box-arrow-right" /> Вийти</button>}</nav></div></header><div id="main-content" className="main-content"><div className="container"><Notice danger>{error || library.error}</Notice></div>{isAdmin ? <Admin library={library} /> : <main><Catalog library={library} /></main>}</div><footer className="site-footer"><div className="container footer-inner"><a className="footer-brand" href="/"><Icon name="book" /> Книгосховище</a><span>Місце, де починаються нові історії.</span><a href="/admin">Для бібліотекаря <Icon name="arrow-up-right" /></a></div></footer></div>;
}
createRoot(document.getElementById('root')).render(<App />);
