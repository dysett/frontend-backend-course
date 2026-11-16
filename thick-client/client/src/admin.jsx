import React, { useEffect, useState } from 'react';
import { api } from './api';
import { BookForm, BorrowForm, Confirm, date, Icon, Notice, StatBar } from './components';

function Login({ library }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!username.trim() || !password) return setError('Укажіть логін і пароль.');
    setBusy(true);
    try { await api('/auth/session'); const session = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } }); setPassword(''); await library.refresh(true); library.setUser(session.user); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="login-layout container"><div className="login-intro"><div className="eyebrow">РОБОЧИЙ ПРОСТІР БІБЛІОТЕКАРЯ</div><h1>Кожна книжка<br />на своєму місці.</h1><p>Керуйте каталогом, видавайте примірники<br />та стежте за їх поверненням.</p><div className="login-decoration" aria-hidden="true"><Icon name="journal-bookmark" /><span>Книгосховище</span></div></div><section className="login-card"><span className="login-icon"><Icon name="shield-lock" /></span><h2>Вхід адміністратора</h2><p className="text-secondary">Використайте обліковий запис бібліотекаря.</p><Notice danger>{error}</Notice><form onSubmit={submit} noValidate><label className="form-label" htmlFor="username">Логін</label><input id="username" className="form-control mb-3" autoComplete="username" maxLength={40} value={username} onChange={e => setUsername(e.target.value)} /><label className="form-label" htmlFor="password">Пароль</label><input id="password" type="password" className="form-control" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /><button type="submit" className="btn btn-primary w-100 mt-4" disabled={busy}>{busy ? 'Входимо…' : 'Увійти'} <Icon name="arrow-right" /></button></form><a href="/" className="login-back"><Icon name="arrow-left" /> Повернутися до каталогу</a></section></div>;
}
export default function Admin({ library }) {
  const [tab, setTab] = useState('books'), [query, setQuery] = useState(''), [modal, setModal] = useState(null), [notice, setNotice] = useState(''), [error, setError] = useState(''), [loans, setLoans] = useState([]), [overdueOnly, setOverdueOnly] = useState(false);
  useEffect(() => { if (!library.user) { setModal(null); setLoans([]); } }, [library.user]);
  useEffect(() => {
    if (!library.user) return;
    let cancelled = false, timer;
    async function poll() {
      try { const data = await api('/loans'); if (!cancelled) { setLoans(data); setError(''); } }
      catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [library.user?.username, library.books]);
  if (!library.ready) return <div className="container empty-state" role="status">Завантажуємо сеанс…</div>;
  if (!library.user) return <Login library={library} />;
  const saved = async message => { setNotice(message); await library.refresh(true); setLoans(await api('/loans')); };
  const books = library.books.filter(book => `${book.title} ${book.author} ${book.isbn}`.toLowerCase().includes(query.toLowerCase().trim()));
  const visibleLoans = loans.filter(loan => (!overdueOnly || loan.overdue) && `${loan.title} ${loan.readerId}`.toLowerCase().includes(query.toLowerCase().trim()));
  const close = () => setModal(null);
  return <main className="container admin-main"><div className="section-heading"><div><div className="eyebrow">РОБОЧИЙ ПРОСТІР</div><h1>Керування бібліотекою</h1><p className="text-secondary mb-0">Каталог, примірники та читачі — в одному місці.</p></div><button className="btn btn-primary" onClick={() => { setNotice(''); setModal({ type: 'book' }); }}><Icon name="plus-lg" /> Додати книжку</button></div><StatBar stats={library.stats} admin /><Notice>{notice}</Notice><Notice danger>{error}</Notice>
    <section className="admin-panel"><div className="admin-toolbar"><div className="nav nav-pills" aria-label="Розділи адміністратора"><button className={`nav-link ${tab === 'books' ? 'active' : ''}`} onClick={() => { setTab('books'); setQuery(''); }}><Icon name="collection" /> Каталог <span>{library.books.length}</span></button><button className={`nav-link ${tab === 'loans' ? 'active' : ''}`} onClick={() => { setTab('loans'); setQuery(''); }}><Icon name="journal-arrow-up" /> Активні видачі <span>{loans.length}</span></button></div><div className="search-box"><Icon name="search" /><input className="form-control" type="search" aria-label={tab === 'books' ? 'Пошук книжок' : 'Пошук видач'} placeholder={tab === 'books' ? 'Назва, автор або ISBN' : 'Книжка або код читача'} value={query} onChange={e => setQuery(e.target.value)} /></div></div>
    {tab === 'books' ? <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Книжка</th><th>Рік</th><th>Примірники</th><th>Дії</th></tr></thead><tbody>{books.map(book => <tr key={book.id}><td><strong className="table-title">{book.title}</strong><span className="table-author">{book.author}</span><span className="isbn">ISBN {book.isbn}</span></td><td>{book.publicationYear}</td><td><span className={`availability ${book.availableCopies ? '' : 'unavailable'}`}><span />{book.availableCopies} із {book.totalCopies} вільні</span></td><td><div className="row-actions"><button className="btn btn-sm btn-outline-primary" disabled={!book.availableCopies} onClick={() => setModal({ type: 'borrow', book })}>Видати</button><button className="btn btn-sm btn-light" aria-label={`Редагувати: ${book.title}`} onClick={() => setModal({ type: 'book', book })}><Icon name="pencil" /></button><button className="btn btn-sm btn-light text-danger" disabled={book.borrowedCopies > 0} title={book.borrowedCopies ? 'Спочатку поверніть усі примірники' : 'Видалити книжку'} aria-label={`Видалити: ${book.title}`} onClick={() => setModal({ type: 'delete', book })}><Icon name="trash3" /></button></div></td></tr>)}</tbody></table>{!books.length && <div className="empty-state"><Icon name="journal" /><h3>Книжок не знайдено</h3><p>Додайте книжку або змініть пошуковий запит.</p></div>}</div> : <><label className="form-check mx-4 my-3"><input type="checkbox" className="form-check-input" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /><span className="form-check-label">Лише прострочені</span></label><div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Книжка</th><th>Читач</th><th>Повернути до</th><th>Дія</th></tr></thead><tbody>{visibleLoans.map(loan => <tr key={loan.id}><td><strong className="table-title">{loan.title}</strong><span className="table-author">Видано {date(loan.borrowedAt)}</span></td><td>{loan.readerId}</td><td><span className={loan.overdue ? 'text-danger fw-semibold' : ''}>{date(loan.dueAt)}</span>{loan.overdue && <span className="table-author text-danger">Прострочено</span>}</td><td><button className="btn btn-sm btn-outline-primary" onClick={() => setModal({ type: 'return', loan })}>Повернути</button></td></tr>)}</tbody></table>{!visibleLoans.length && <div className="empty-state"><Icon name="journal-check" /><h3>Видач не знайдено</h3><p>Нові видачі з’являтимуться тут автоматично.</p></div>}</div></>}
    </section><p className="catalog-note"><Icon name="shield-check" /> Сеанс адміністратора діє 30 хвилин після входу.</p>
    {modal?.type === 'book' && <BookForm book={modal.book} onClose={close} onSaved={saved} />}
    {modal?.type === 'borrow' && <BorrowForm book={modal.book} onClose={close} onSaved={saved} />}
    {modal?.type === 'delete' && <Confirm title="Видалити книжку?" message={`«${modal.book.title}» буде вилучено з каталогу. Цю дію неможливо скасувати.`} action="Видалити" danger onClose={close} onConfirm={async () => { await api(`/books/${modal.book.id}`, { method: 'DELETE' }); await saved('Книжку видалено.'); }} />}
    {modal?.type === 'return' && <Confirm title="Прийняти повернення?" message={`«${modal.loan.title}» від читача ${modal.loan.readerId}. Примірник знову стане доступним.`} action="Повернути примірник" onClose={close} onConfirm={async () => { await api(`/books/${modal.loan.bookId}/loans/${modal.loan.id}`, { method: 'DELETE' }); await saved('Примірник повернуто до бібліотеки.'); }} />}
  </main>;
}
