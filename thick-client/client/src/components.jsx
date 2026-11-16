import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';

export function Icon({ name, className = '' }) { return <i className={`bi bi-${name} ${className}`} aria-hidden="true" />; }
export const date = value => new Date(value).toLocaleDateString('uk-UA');
export function Notice({ children, danger = false }) {
  return children ? <div className={`alert ${danger ? 'alert-danger' : 'alert-success'} d-flex gap-2 align-items-start`} role={danger ? 'alert' : 'status'}><Icon name={danger ? 'exclamation-circle' : 'check-circle'} /><span>{children}</span></div> : null;
}
export function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="app-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="btn-close" aria-label="Закрити" onClick={onClose} /></div>
    {children}
  </dialog>;
}
export function BookCover({ book, small = false }) {
  const color = Number(book.isbn.slice(-2)) % 5;
  return <div className={`book-cover cover-${color} ${small ? 'cover-small' : ''}`} aria-hidden="true">
    <div className="cover-top">БІБЛІОТЕКА · {book.publicationYear}</div><div className="cover-orbit" />
    <div className="cover-name">{book.title}</div><div className="cover-author">{book.author}</div><Icon name="book" />
  </div>;
}
export function StatBar({ stats, admin = false }) {
  const items = [['journal-bookmark', 'Назв у каталозі', stats?.titles], ['collection', 'Примірників у фонді', stats?.totalCopies], ['book', 'Доступні для читання', stats?.availableCopies], [admin ? 'clock-history' : 'people', admin ? 'Прострочені видачі' : 'Зараз у читачів', admin ? stats?.overdueLoans : stats?.borrowedCopies]];
  return <div className="row g-0 stats-bar">{items.map(([icon, label, value]) => <div className="col-6 col-lg-3 stat-item" key={label}><Icon name={icon} /><div><strong>{value ?? '—'}</strong><span>{label}</span></div></div>)}</div>;
}
export function BookDetails({ book, onClose }) {
  return <Modal title="Про книжку" onClose={onClose}><div className="detail-grid"><BookCover book={book} /><div><span className="genre-label">{book.genre}</span><h3 className="mt-3">{book.title}</h3><p>{book.author}</p><dl className="book-meta"><dt>Рік видання</dt><dd>{book.publicationYear}</dd><dt>ISBN</dt><dd>{book.isbn}</dd><dt>Примірників</dt><dd>{book.totalCopies}</dd><dt>Доступно</dt><dd>{book.availableCopies}</dd></dl><p className="text-secondary small">Щоб отримати примірник, зверніться до бібліотекаря.</p></div></div><button className="btn btn-primary w-100 mt-4" onClick={onClose}>Повернутися до каталогу</button></Modal>;
}
const emptyBook = { title: '', author: '', isbn: '', publicationYear: '', genre: '', totalCopies: '1' };
export function BookForm({ book, onClose, onSaved }) {
  const [fields, setFields] = useState(book ? Object.fromEntries(Object.keys(emptyBook).map(key => [key, String(book[key])])) : emptyBook);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = event => { setFields({ ...fields, [event.target.name]: event.target.value }); setErrors({ ...errors, [event.target.name]: '' }); };
  async function submit(event) {
    event.preventDefault();
    const issues = {};
    for (const [key, label, max] of [['title', 'Назва', 200], ['author', 'Автор', 200], ['genre', 'Жанр', 80]]) if (!fields[key].trim() || fields[key].trim().length > max) issues[key] = `${label}: від 1 до ${max} символів.`;
    const isbn = fields.isbn.replace(/[ -]/g, '');
    if (!/^97[89]\d{10}$/.test(isbn) || [...isbn].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10 !== 0) issues.isbn = 'Укажіть ISBN-13 із правильною контрольною цифрою.';
    const year = Number(fields.publicationYear), copies = Number(fields.totalCopies);
    if (!Number.isInteger(year) || year < 1 || year > new Date().getUTCFullYear()) issues.publicationYear = `Рік: від 1 до ${new Date().getUTCFullYear()}.`;
    if (!Number.isInteger(copies) || copies < 1 || copies > 100) issues.totalCopies = 'Від 1 до 100 примірників.';
    setErrors(issues); if (Object.keys(issues).length) return;
    setBusy(true); setError('');
    try {
      await api(book ? `/books/${book.id}` : '/books', { method: book ? 'PUT' : 'POST', body: { ...fields, isbn, publicationYear: year, totalCopies: copies } });
      await onSaved(book ? 'Дані книжки оновлено.' : 'Книжку додано. Відкриті каталоги оновляться автоматично.'); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const field = (name, label, type = 'text', placeholder = '') => <div className={['publicationYear', 'totalCopies'].includes(name) ? 'col-sm-6' : 'col-12'} key={name}><label htmlFor={`book-${name}`} className="form-label">{label}</label><input id={`book-${name}`} className={`form-control ${errors[name] ? 'is-invalid' : ''}`} name={name} type={type} value={fields[name]} onChange={change} placeholder={placeholder} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} maxLength={name === 'genre' ? 80 : 200} /><div id={`error-${name}`} className="invalid-feedback">{errors[name]}</div></div>;
  return <Modal title={book ? 'Редагувати книжку' : 'Додати книжку'} onClose={onClose}><form onSubmit={submit} noValidate><p className="text-secondary small">Усі поля обов’язкові. Доступність примірників обчислюється автоматично.</p><Notice danger>{error}</Notice><div className="row g-3">{field('title', 'Назва книжки', 'text', 'Наприклад, Clean Code')}{field('author', 'Автор', 'text', 'Ім’я та прізвище')}{field('isbn', 'ISBN-13', 'text', '9780132350884')}{field('genre', 'Жанр', 'text', 'Наприклад, Програмування')}{field('publicationYear', 'Рік видання', 'number')}{field('totalCopies', 'Кількість примірників', 'number')}</div><div className="dialog-actions"><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Скасувати</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Зберігаємо…' : 'Зберегти книжку'}</button></div></form></Modal>;
}
export function BorrowForm({ book, onClose, onSaved }) {
  const [readerId, setReaderId] = useState('');
  const [days, setDays] = useState('14');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(readerId.trim()) || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 30) return setError('Код читача: 1–64 літери, цифри, дефіси або підкреслення. Строк: 1–30 діб.');
    setBusy(true);
    try { await api(`/books/${book.id}/loans`, { method: 'POST', body: { readerId: readerId.trim(), days: Number(days) } }); await onSaved('Примірник видано читачеві.'); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="Видати примірник" onClose={onClose}><p>{book.title} · доступно {book.availableCopies}</p><Notice danger>{error}</Notice><form onSubmit={submit} noValidate><label htmlFor="reader" className="form-label">Код читача</label><input id="reader" className="form-control mb-3" value={readerId} onChange={e => setReaderId(e.target.value)} placeholder="reader-001" maxLength={64} /><label htmlFor="days" className="form-label">Строк видачі, діб</label><input id="days" className="form-control" type="number" min="1" max="30" value={days} onChange={e => setDays(e.target.value)} /><div className="dialog-actions"><button type="button" className="btn btn-light" onClick={onClose}>Скасувати</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Видаємо…' : 'Підтвердити видачу'}</button></div></form></Modal>;
}
export function Confirm({ title, message, action, onClose, onConfirm, danger = false }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={title} onClose={onClose}><p>{message}</p><Notice danger>{error}</Notice><div className="dialog-actions"><button className="btn btn-light" onClick={onClose} disabled={busy}>Скасувати</button><button className={`btn btn-${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>{busy ? 'Виконуємо…' : action}</button></div></Modal>;
}
