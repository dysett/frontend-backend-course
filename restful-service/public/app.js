const $ = selector => document.querySelector(selector);
const state = { books: [], loans: [], statistics: null, view: 'catalog', bookSequence: 0, loanSequence: 0, confirmAction: null, selectedBook: null };
let searchTimer;
let toastTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function date(value) {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function time(value) {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function recordRequest(method, path, body, status, response) {
  $('#request-line').textContent = `${method} ${path}`;
  $('#request-body').textContent = `${method} ${path}${body === undefined ? '\nБез тіла запиту' : '\nContent-Type: application/json\n\n' + JSON.stringify(body, null, 2)}`;
  $('#response-status').textContent = `· ${status}`;
  $('#response-body').textContent = JSON.stringify(response, null, 2);
}

async function api(path, { method = 'GET', body, inspect = true } = {}) {
  let response;
  let json;
  try {
    response = await fetch(path, {
      method, signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    json = await response.json();
  } catch {
    if (inspect) recordRequest(method, path, body, 'Немає відповіді', { error: 'Не вдалося отримати JSON-відповідь сервера.' });
    throw new Error('Немає зв’язку із сервісом. Перевірте, що сервер запущений, і повторіть дію.');
  }
  if (inspect) recordRequest(method, path, body, response.status, json);
  if (!response.ok) throw new Error(json.error?.message || 'Не вдалося виконати дію.');
  return json;
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  const box = $('#toast');
  box.querySelector('span').textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 9000 : 6500);
}

function globalError(error) {
  $('#global-error').textContent = error.message;
  $('#global-error').hidden = false;
}

function showDialog(selector) {
  const dialog = $(selector);
  const error = dialog.querySelector('.form-error');
  if (error) error.hidden = true;
  dialog.querySelectorAll('input').forEach(clearFieldError);
  dialog.showModal();
  return dialog;
}

function dialogError(dialog, error) {
  const box = dialog.querySelector('.form-error');
  box.textContent = error.message;
  box.hidden = false;
}

function fieldErrorId(field) {
  return `${field.form.id}-${field.name}-error`;
}

function clearFieldError(field) {
  if (!field.form) return;
  const id = fieldErrorId(field);
  document.getElementById(id)?.remove();
  field.removeAttribute('aria-invalid');
  const describedBy = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
  if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
  else field.removeAttribute('aria-describedby');
}

// Власні підказки залишаються українськими за будь-якої мови браузера.
function validationMessage(field) {
  const value = field.value.trim();
  const validity = field.validity;
  if (validity.badInput) return 'Введіть коректне число.';
  if (field.required && !value) return 'Заповніть це поле.';
  if (validity.typeMismatch || validity.patternMismatch) return 'Введіть значення у правильному форматі.';
  if (validity.rangeUnderflow || validity.rangeOverflow) {
    if (field.min && field.max) return `Введіть ціле число від ${field.min} до ${field.max}.`;
    return field.min ? `Введіть число не менше ${field.min}.` : `Введіть число не більше ${field.max}.`;
  }
  if (validity.stepMismatch) return field.step === '1' ? 'Введіть ціле число.' : `Введіть число з кроком ${field.step}.`;
  if (validity.tooLong) return `Введіть не більше ${field.maxLength} символів.`;
  if (validity.tooShort) return `Введіть щонайменше ${field.minLength} символів.`;
  if (!validity.valid) return 'Перевірте значення цього поля.';
  if (field.name === 'readerId' && value && !/^[\p{L}\p{N}_-]+$/u.test(value)) {
    return 'Використовуйте лише літери, цифри, дефіс або підкреслення.';
  }
  return '';
}

function validateForm(form) {
  let firstInvalid;
  for (const field of form.querySelectorAll('input, select, textarea')) {
    clearFieldError(field);
    if (!field.willValidate) continue;
    const message = validationMessage(field);
    if (!message) continue;
    const error = element('span', 'field-error', message);
    error.id = fieldErrorId(field);
    field.insertAdjacentElement('afterend', error);
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
    firstInvalid ??= field;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ block: 'nearest' });
  }
  return !firstInvalid;
}

async function submitDialog(form, operation) {
  const dialog = form.closest('dialog');
  dialog.querySelector('.form-error').hidden = true;
  if (!validateForm(form)) return;
  dialog.dataset.busy = 'true';
  const buttons = [...dialog.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  dialog.querySelector('.form-error').hidden = true;
  try { await operation(); }
  catch (error) { dialogError(dialog, error); }
  finally {
    delete dialog.dataset.busy;
    buttons.forEach(button => { button.disabled = false; });
  }
}

function emptyRow(target, columns, title, description) {
  const cell = element('td', 'empty');
  cell.colSpan = columns;
  cell.append(element('strong', '', title), element('span', '', description));
  const row = element('tr');
  row.append(cell);
  target.replaceChildren(row);
}

function renderBooks() {
  const target = $('#book-rows');
  $('#book-count').textContent = state.books.length;
  $('#catalog-summary').textContent = `Показано книжок: ${state.books.length}`;
  if (!state.books.length) {
    emptyRow(target, 4, 'Книжок не знайдено', $('#book-search').value || $('#availability').value ? 'Змініть пошук або фільтр доступності.' : 'Натисніть «Додати книжку», щоб створити перший запис.');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const [index, book] of state.books.entries()) {
    const row = $('#book-row-template').content.cloneNode(true);
    row.querySelector('.book-title').textContent = book.title;
    row.querySelector('.book-author').textContent = book.author;
    row.querySelector('.book-isbn').textContent = `ISBN ${book.isbn}`;
    const spine = row.querySelector('.book-spine');
    spine.textContent = [...book.title.trim().split(/\s+/).slice(0, 2)].map(word => [...word][0]).join('').toUpperCase();
    spine.classList.add(`tone-${index % 3}`);
    row.querySelector('.genre-tag').textContent = book.genre;
    row.querySelector('.book-year').textContent = `${book.publicationYear} рік`;
    const copies = row.querySelector('.copies-number');
    copies.textContent = `${book.availableCopies} з ${book.totalCopies}`;
    copies.classList.toggle('unavailable', book.availableCopies === 0);
    row.querySelector('.copies-label').textContent = book.availableCopies ? 'доступно для видачі' : 'усі примірники видано';
    row.querySelector('.stock-track i').style.width = `${book.availableCopies / book.totalCopies * 100}%`;
    const borrow = row.querySelector('.borrow-button');
    borrow.disabled = book.availableCopies === 0;
    borrow.title = book.availableCopies ? 'Видати один примірник читачу' : 'Немає вільних примірників';
    borrow.setAttribute('aria-label', `Видати книжку ${book.title}`);
    borrow.addEventListener('click', () => openBorrow(book));
    const loans = row.querySelector('.loan-button');
    loans.querySelector('span').textContent = `(${book.borrowedCopies})`;
    loans.setAttribute('aria-label', `Видачі книжки ${book.title}`);
    loans.addEventListener('click', () => openBookLoans(book));
    const edit = row.querySelector('.edit-button');
    edit.setAttribute('aria-label', `Редагувати книжку ${book.title}`);
    edit.addEventListener('click', () => openBook(book));
    const remove = row.querySelector('.delete-button');
    remove.disabled = book.borrowedCopies > 0;
    remove.title = book.borrowedCopies ? 'Спочатку поверніть усі видані примірники' : 'Видалити книжку з каталогу';
    remove.setAttribute('aria-label', `Видалити книжку ${book.title}`);
    remove.addEventListener('click', () => confirmDelete(book));
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

function returnButton(loan, title, className = 'button compact') {
  const button = element('button', className);
  button.type = 'button';
  button.append(icon('return'), document.createTextNode('Повернути'));
  button.setAttribute('aria-label', `Повернути книжку ${title} від читача ${loan.readerId}`);
  button.addEventListener('click', () => confirmReturn(loan, title));
  return button;
}

function renderLoans() {
  const search = $('#loan-search').value.trim().toLocaleLowerCase('uk');
  const loans = state.loans.filter(loan => `${loan.title} ${loan.readerId}`.toLocaleLowerCase('uk').includes(search));
  const target = $('#loan-rows');
  $('#loan-count').textContent = loans.length;
  if (!loans.length) {
    emptyRow(target, 4, 'Видач у цьому списку немає', search || $('#loan-status').value ? 'Змініть пошук або фільтр статусу.' : 'Усі примірники в бібліотеці. Нову видачу можна оформити в каталозі.');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const loan of loans) {
    const row = element('tr');
    const book = element('td');
    book.append(element('strong', 'book-title', loan.title), element('span', 'loan-reader', `Читач: ${loan.readerId}`));
    const borrowed = element('td', 'date', date(loan.borrowedAt));
    borrowed.append(element('small', '', time(loan.borrowedAt)));
    const due = element('td', 'date', date(loan.dueAt));
    due.append(element('small', '', time(loan.dueAt)), element('span', `status-tag${loan.overdue ? ' overdue' : ''}`, loan.overdue ? 'Прострочено' : 'Строк не минув'));
    const action = element('td');
    action.append(returnButton(loan, loan.title));
    row.append(book, borrowed, due, action);
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

async function loadBooks(inspect = true) {
  const sequence = ++state.bookSequence;
  const params = new URLSearchParams();
  const search = $('#book-search').value.trim();
  if (search) params.set('q', search);
  if ($('#availability').value) params.set('available', $('#availability').value);
  const path = `/api/books${params.size ? '?' + params : ''}`;
  $('#catalog-view').setAttribute('aria-busy', 'true');
  try {
    const { data } = await api(path, { inspect });
    if (sequence !== state.bookSequence) return;
    state.books = data;
    renderBooks();
  } finally {
    if (sequence === state.bookSequence) $('#catalog-view').removeAttribute('aria-busy');
  }
}

async function loadLoans(inspect = true) {
  const sequence = ++state.loanSequence;
  const path = `/api/loans${$('#loan-status').value ? '?overdue=true' : ''}`;
  const { data } = await api(path, { inspect });
  if (sequence !== state.loanSequence) return;
  state.loans = data;
  renderLoans();
}

async function loadStatistics() {
  const { data } = await api('/api/statistics', { inspect: false });
  state.statistics = data;
  $('#stat-titles').textContent = data.titles;
  $('#stat-available').textContent = data.availableCopies;
  $('#stat-borrowed').textContent = data.borrowedCopies;
  $('#stat-overdue').textContent = data.overdueLoans;
  $('#nav-loan-count').textContent = data.borrowedCopies;
}

async function refresh({ inspect = false } = {}) {
  $('#global-error').hidden = true;
  const buttons = [...document.querySelectorAll('.refresh-button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await Promise.all([loadBooks(inspect && state.view === 'catalog'), loadLoans(inspect && state.view === 'loans'), loadStatistics()]);
    $('#connection').className = 'connection online';
    $('#connection').replaceChildren(element('i'), document.createTextNode('MongoDB підключено'));
    return true;
  } catch (error) {
    $('#connection').className = 'connection offline';
    $('#connection').replaceChildren(element('i'), document.createTextNode('Немає з’єднання'));
    globalError(error);
    return false;
  } finally { buttons.forEach(button => { button.disabled = false; }); }
}

function setView(view, load = true) {
  state.view = view;
  $('#catalog-view').hidden = view !== 'catalog';
  $('#loans-view').hidden = view !== 'loans';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#page-title').textContent = view === 'catalog' ? 'Книжки під рукою' : 'Книжки у читачів';
  $('#page-description').textContent = view === 'catalog' ? 'Додавайте книжки до каталогу, видавайте примірники та стежте за поверненнями.' : 'Переглядайте строки видач і приймайте примірники назад до бібліотеки.';
  if (load) (view === 'catalog' ? loadBooks() : loadLoans()).catch(globalError);
}

function openBook(book) {
  const form = $('#book-form');
  form.reset();
  form.elements.bookId.value = book?.id || '';
  form.elements.publicationYear.max = new Date().getUTCFullYear();
  if (book) {
    for (const key of ['title', 'author', 'isbn', 'publicationYear', 'totalCopies', 'genre']) form.elements[key].value = book[key];
  }
  $('#book-dialog-title').textContent = book ? 'Редагувати книжку' : 'Додати книжку';
  $('#book-submit').textContent = book ? 'Зберегти зміни' : 'Додати книжку';
  showDialog('#book-dialog');
  form.elements.title.focus();
}

function updateDuePreview() {
  const days = Number($('#borrow-form').elements.days.value);
  $('#due-preview').textContent = days >= 1 && days <= 30 ? `Орієнтовне повернення: ${date(Date.now() + days * 86400000)}. Точний час визначить сервер.` : 'Вкажіть від 1 до 30 діб.';
}

function openBorrow(book) {
  const form = $('#borrow-form');
  form.reset();
  form.elements.bookId.value = book.id;
  state.selectedBook = book;
  $('#borrow-book-title').textContent = book.title;
  $('#borrow-availability').textContent = `Доступно: ${book.availableCopies} з ${book.totalCopies}`;
  updateDuePreview();
  showDialog('#borrow-dialog');
  form.elements.readerId.focus();
}

async function openBookLoans(book) {
  state.selectedBook = book;
  $('#book-loans-title').textContent = book.title;
  $('#book-loans-list').replaceChildren(element('p', 'empty', 'Завантажуємо видачі…'));
  showDialog('#book-loans-dialog');
  try { await fillBookLoans(book); }
  catch (error) { dialogError($('#book-loans-dialog'), error); }
}

async function fillBookLoans(book, inspect = true) {
  const { data } = await api(`/api/books/${book.id}/loans`, { inspect });
  const target = $('#book-loans-list');
  if (!data.length) {
    target.replaceChildren(element('p', 'empty', 'Активних видач немає. Усі примірники цієї книжки в бібліотеці.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const loan of data) {
    const card = element('div', 'loan-card');
    const information = element('div');
    information.append(element('strong', '', loan.readerId), element('p', '', `Видано: ${date(loan.borrowedAt)}`));
    const due = element('time', '', `Повернути до: ${date(loan.dueAt)}, ${time(loan.dueAt)}`);
    due.dateTime = loan.dueAt;
    information.append(due, element('span', `status-tag${loan.overdue ? ' overdue' : ''}`, loan.overdue ? 'Прострочено' : 'Строк не минув'));
    card.append(information, returnButton(loan, book.title));
    fragment.append(card);
  }
  target.replaceChildren(fragment);
}

function confirmDelete(book) {
  $('#confirm-title').textContent = 'Видалити книжку?';
  $('#confirm-description').textContent = `«${book.title}» буде вилучено з каталогу разом із даними видання. Підтвердьте видалення.`;
  $('#confirm-submit').textContent = 'Видалити книжку';
  $('#confirm-submit').className = 'button danger';
  state.confirmAction = async () => {
    await api(`/api/books/${book.id}`, { method: 'DELETE' });
    $('#confirm-dialog').close();
    toast(`Книжку «${book.title}» видалено з каталогу.`);
    await refresh();
  };
  showDialog('#confirm-dialog');
}

function confirmReturn(loan, title) {
  const previous = $('#book-loans-dialog');
  const reopenBook = previous.open ? { ...state.selectedBook } : null;
  if (previous.open) previous.close();
  $('#confirm-title').textContent = 'Прийняти повернення?';
  $('#confirm-description').textContent = `Повернути примірник «${title}» від читача ${loan.readerId}? Після підтвердження він знову буде доступний для видачі.`;
  $('#confirm-submit').textContent = 'Повернути примірник';
  $('#confirm-submit').className = 'button primary';
  state.confirmAction = async () => {
    await api(`/api/books/${loan.bookId}/loans/${loan.id}`, { method: 'DELETE' });
    $('#confirm-dialog').close();
    toast(`Примірник «${title}» повернуто. Він знову доступний.`);
    await refresh();
    if (reopenBook) {
      state.selectedBook = reopenBook;
      showDialog('#book-loans-dialog');
      await fillBookLoans(reopenBook, false);
    }
  };
  showDialog('#confirm-dialog');
}

$('#book-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitDialog(form, async () => {
    const fields = new FormData(form);
    const id = fields.get('bookId');
    const body = Object.fromEntries(['title', 'author', 'isbn', 'genre'].map(key => [key, fields.get(key)]));
    body.publicationYear = Number(fields.get('publicationYear'));
    body.totalCopies = Number(fields.get('totalCopies'));
    await api(id ? `/api/books/${id}` : '/api/books', { method: id ? 'PUT' : 'POST', body });
    $('#book-dialog').close();
    if (!id) {
      $('#book-search').value = '';
      $('#availability').value = '';
      if (state.view !== 'catalog') setView('catalog', false);
    }
    toast(id ? `Зміни книжки «${body.title}» збережено.` : `Книжку «${body.title}» додано до каталогу.`);
    await refresh();
  });
});

$('#borrow-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitDialog(form, async () => {
    const fields = new FormData(form);
    const { data } = await api(`/api/books/${fields.get('bookId')}/loans`, {
      method: 'POST', body: { readerId: fields.get('readerId'), days: Number(fields.get('days')) },
    });
    $('#borrow-dialog').close();
    toast(`Книжку видано читачу ${data.readerId}. Повернути до ${date(data.dueAt)}.`);
    await refresh();
  });
});

$('#confirm-form').addEventListener('submit', event => {
  event.preventDefault();
  if (state.confirmAction) submitDialog(event.currentTarget, state.confirmAction);
});

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
  const dialog = button.closest('dialog');
  if (dialog.dataset.busy !== 'true') dialog.close();
}));
document.querySelectorAll('form').forEach(form => form.addEventListener('input', event => {
  if (event.target.matches('input, select, textarea')) clearFieldError(event.target);
}));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => {
  if (dialog.dataset.busy === 'true') event.preventDefault();
}));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('.refresh-button').forEach(button => button.addEventListener('click', async () => {
  if (await refresh({ inspect: true })) toast('Дані бібліотеки оновлено.');
}));
$('#add-book').addEventListener('click', () => openBook());
$('#help-button').addEventListener('click', () => showDialog('#help-dialog'));
$('#toast button').addEventListener('click', () => { $('#toast').hidden = true; });
$('#borrow-form').elements.days.addEventListener('input', updateDuePreview);
$('#book-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadBooks().catch(globalError), 250);
});
$('#availability').addEventListener('change', () => loadBooks().catch(globalError));
$('#loan-search').addEventListener('input', renderLoans);
$('#loan-status').addEventListener('change', () => loadLoans().catch(globalError));
refresh({ inspect: true });
