/* Представлення: DOM та запити fetch. Дані зберігає сервер у MongoDB. */
const $ = selector => document.querySelector(selector);
const state = { contacts: [], templates: [], campaigns: [], config: {}, selected: new Set(), page: 1, pageSize: 8, deleteId: null, sending: false };
const collator = new Intl.Collator('uk', { sensitivity: 'base' });
const contactModal = new bootstrap.Modal($('#contact-modal'));
const deleteModal = new bootstrap.Modal($('#delete-modal'));
const campaignModal = new bootstrap.Modal($('#campaign-modal'));
const toast = new bootstrap.Toast($('#notification'), { delay: 4500 });
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fullName = contact => `${contact.lastName} ${contact.firstName} ${contact.middleName}`;
const date = value => new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch { throw new Error('Немає зв’язку із сервером. Перевірте підключення та оновіть сторінку.'); }
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Не вдалося виконати запит.'), { fields: body.fields });
  return body;
}
function notify(message) { $('#notification-text').textContent = message; toast.show(); }
function showError(error) { $('#global-error').textContent = error.message; $('#global-error').classList.remove('d-none'); }
function clearError() { $('#global-error').classList.add('d-none'); }
function route() {
  const requested = location.hash.slice(1);
  const current = ['contacts', 'compose', 'templates', 'history'].includes(requested) ? requested : 'contacts';
  document.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== current; });
  document.querySelectorAll('[data-nav]').forEach(link => {
    link.classList.toggle('active', link.dataset.nav === current);
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  clearError();
  if (current === 'history') loadHistory().catch(showError);
  if (current === 'compose') renderRecipients();
}
function filteredContacts() {
  const query = $('#search').value.trim().toLocaleLowerCase('uk');
  const [field, direction] = $('#sort').value.split('-');
  return state.contacts.filter(contact => `${fullName(contact)} ${contact.email}`.toLocaleLowerCase('uk').includes(query))
    .sort((a, b) => (direction === 'desc' ? -1 : 1) * collator.compare(field === 'email' ? a.email : fullName(a), field === 'email' ? b.email : fullName(b)));
}
function visibleContacts() {
  const filtered = filteredContacts();
  state.page = Math.max(1, Math.min(state.page, Math.ceil(filtered.length / state.pageSize)));
  return filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
}
function renderContacts() {
  const rows = visibleContacts();
  const filtered = filteredContacts();
  $('#contact-rows').innerHTML = rows.length ? rows.map((contact, index) => `<tr class="${state.selected.has(contact._id) ? 'selected' : ''}"><td class="check-cell"><input type="checkbox" class="form-check-input contact-check" value="${contact._id}" aria-label="Вибрати ${escape(fullName(contact))}" ${state.selected.has(contact._id) ? 'checked' : ''}></td><td><div class="contact-person"><span class="avatar tone-${index % 4}" aria-hidden="true">${escape(contact.firstName[0] + contact.lastName[0])}</span><div><strong>${escape(contact.lastName)} ${escape(contact.firstName)}</strong><small>${escape(contact.middleName)}</small></div></div></td><td><a class="contact-email" href="mailto:${escape(contact.email)}">${escape(contact.email)}</a></td><td><div class="row-actions"><button class="icon-button" type="button" data-edit="${contact._id}" aria-label="Редагувати ${escape(fullName(contact))}" title="Редагувати"><i class="bi bi-pencil" aria-hidden="true"></i></button><button class="icon-button delete" type="button" data-delete="${contact._id}" aria-label="Вилучити ${escape(fullName(contact))}" title="Вилучити"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></td></tr>`).join('') : `<tr><td colspan="4" class="empty-state"><i class="bi bi-people" aria-hidden="true"></i><strong>${state.contacts.length ? 'Контактів не знайдено' : 'Почніть із першого контакту'}</strong>${state.contacts.length ? 'Спробуйте інше ім’я або електронну адресу.' : 'Натисніть «Додати контакт», щоб наповнити список.'}</td></tr>`;
  $('#contact-count').textContent = state.contacts.length;
  $('#stat-contacts').textContent = state.contacts.length;
  $('#nav-count').textContent = state.contacts.length;
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  $('#page-info').textContent = filtered.length ? `${(state.page - 1) * state.pageSize + 1}–${Math.min(state.page * state.pageSize, filtered.length)} із ${filtered.length} контактів` : '0 контактів';
  $('#page-number').textContent = `${state.page} / ${pages}`;
  $('#previous-page').disabled = state.page === 1;
  $('#next-page').disabled = state.page >= pages;
  $('#select-page').checked = rows.length > 0 && rows.every(contact => state.selected.has(contact._id));
  $('#select-page').indeterminate = rows.some(contact => state.selected.has(contact._id)) && !$('#select-page').checked;
  $('#select-page').disabled = !rows.length;
  $('#selection-bar').classList.toggle('d-none', !state.selected.size);
  $('#selected-count').textContent = state.selected.size;
}
async function loadContacts() {
  state.contacts = await api('/contacts');
  const existing = new Set(state.contacts.map(contact => contact._id));
  state.selected = new Set([...state.selected].filter(id => existing.has(id)));
  renderContacts(); renderRecipients();
}
function renderRecipients() {
  $('#all-recipient-count').textContent = state.contacts.length;
  $('#chosen-recipient-count').textContent = state.selected.size;
  $('#recipient-picker').innerHTML = state.contacts.length ? state.contacts.map(contact => `<label><input class="form-check-input recipient-check" type="checkbox" value="${contact._id}" ${state.selected.has(contact._id) ? 'checked' : ''}><span>${escape(fullName(contact))}<small>${escape(contact.email)}</small></span></label>`).join('') : '<p class="small text-secondary m-2">Додайте контакти до списку розсилки.</p>';
  updateCompose();
}
function updateCompose() {
  const selected = $('input[name="audience"]:checked').value === 'selected';
  $('#recipient-picker').classList.toggle('d-none', !selected);
  $('#chosen-recipient-count').textContent = state.selected.size;
  const count = selected ? state.selected.size : state.contacts.length;
  $('#send-summary').textContent = `Одержувачів: ${count}`;
  $('#send-button').disabled = state.sending || !count;
  $('#preview-subject').textContent = $('#subject').value.trim() || 'Тут буде тема листа';
  $('#preview-text').textContent = $('#message-text').value || 'Ваше повідомлення з’явиться тут, щойно ви почнете писати.';
  $('#character-count').textContent = `${$('#message-text').value.length.toLocaleString('uk-UA')} / 10 000`;
}
function editContact(contact = {}) {
  $('#contact-form').reset();
  $('#contact-form').querySelectorAll('.is-invalid').forEach(input => input.classList.remove('is-invalid'));
  $('#contact-error').classList.add('d-none');
  $('#contact-id').value = contact._id || '';
  for (const key of ['lastName', 'firstName', 'middleName', 'email']) $('#contact-form').elements[key].value = contact[key] || '';
  $('#contact-modal-title').textContent = contact._id ? 'Редагувати контакт' : 'Новий контакт';
  contactModal.show();
}
function useTemplate(id) {
  const template = state.templates.find(item => item.id === id);
  $('#message-template').value = id;
  $('#subject').value = template?.subject || '';
  $('#message-text').value = template?.text || '';
  updateCompose();
}
function renderTemplates() {
  $('#stat-templates').textContent = state.templates.length;
  $('#message-template').innerHTML = '<option value="">Власне повідомлення</option>' + state.templates.map(template => `<option value="${template.id}">${escape(template.title)}</option>`).join('');
  $('#template-cards').innerHTML = state.templates.map(template => `<div class="col-lg-4 col-md-6"><article class="content-panel template-card"><span class="template-icon"><i class="bi bi-${template.icon}" aria-hidden="true"></i></span><div class="template-category">${escape(template.category)}</div><h2>${escape(template.title)}</h2><p>${escape(template.description)}</p><div class="template-excerpt">${escape(template.text)}</div><button type="button" class="btn btn-outline-secondary" data-template="${template.id}">Використати шаблон <i class="bi bi-arrow-right ms-2" aria-hidden="true"></i></button></article></div>`).join('');
}
const statusLabels = { completed: 'Завершено', partial: 'Частково', failed: 'Помилка', sending: 'В обробці', interrupted: 'Перервано' };
async function loadHistory() {
  state.campaigns = await api('/campaigns');
  $('#stat-campaigns').textContent = state.campaigns.length;
  $('#history-rows').innerHTML = state.campaigns.length ? state.campaigns.map(campaign => `<tr><td><strong>${escape(campaign.subject)}</strong><small>${date(campaign.createdAt)}</small></td><td>${campaign.mode === 'preview' ? 'Локальний перегляд' : 'SMTP'}</td><td><span class="status-tag ${campaign.status}">${statusLabels[campaign.status] || campaign.status}</span><div class="mt-2 text-secondary">Успішно: ${campaign.succeeded} із ${campaign.total}${campaign.failed ? ` · Помилок: ${campaign.failed}` : ''}</div></td><td class="text-end"><button class="btn btn-sm btn-light" type="button" data-campaign="${campaign._id}">Деталі</button></td></tr>`).join('') : '<tr><td class="empty-state" colspan="4"><i class="bi bi-envelope" aria-hidden="true"></i><strong>Перший лист ще попереду</strong>Створіть розсилку, щоб побачити її результат тут.</td></tr>';
}
function showCampaign(campaign) {
  $('#campaign-title').textContent = campaign.subject;
  const summary = campaign.mode === 'preview' ? 'Створено локальні файли листів. Фактичного надсилання не було.' : 'Успішні листи прийняв SMTP-сервер. Це ще не підтверджує отримання у скриньці.';
  $('#campaign-details').innerHTML = `<p class="small text-secondary">${date(campaign.createdAt)} · ${statusLabels[campaign.status]}</p><p>${summary}</p><div class="d-flex gap-3 mb-4"><span class="status-tag">Успішно: ${campaign.succeeded} / ${campaign.total}</span>${campaign.failed ? `<span class="status-tag failed">Помилок: ${campaign.failed}</span>` : ''}</div>${campaign.status === 'interrupted' ? '<div class="alert alert-warning small">Сервер зупинився до завершення розсилки. Для записів без результату стан доставки невідомий. Перевірте його перед повторним надсиланням.</div>' : ''}<div class="campaign-text mb-4">${escape(campaign.text)}</div><h3 class="fs-6">Одержувачі</h3>${campaign.recipients.map(recipient => `<div class="recipient-result"><div><strong>${escape(recipient.name)}</strong><small>${escape(recipient.email)}</small>${recipient.error ? `<small class="text-danger">${escape(recipient.error)}</small>` : ''}</div><div><span class="status-tag ${recipient.status === 'failed' ? 'failed' : ''}">${({ preview: 'Файл готовий', sent: 'Прийнято SMTP', failed: 'Помилка', pending: 'Без результату' })[recipient.status]}</span>${recipient.status === 'preview' ? `<a class="btn btn-sm btn-light" href="/api/campaigns/${campaign._id}/messages/${recipient.contactId}"><i class="bi bi-download me-1" aria-hidden="true"></i>.eml</a>` : ''}</div></div>`).join('')}`;
  campaignModal.show();
}

$('#add-contact').addEventListener('click', () => editContact());
$('#contact-modal').addEventListener('shown.bs.modal', () => $('#last-name').focus());
$('#contact-form').addEventListener('input', event => event.target.classList.remove('is-invalid'));
$('#contact-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#contact-id').value;
  const contact = Object.fromEntries(new FormData(event.target));
  $('#save-contact').disabled = true;
  $('#contact-error').classList.add('d-none');
  try {
    await api(`/contacts${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(contact) });
    contactModal.hide(); await loadContacts(); notify(id ? 'Контакт оновлено.' : 'Новий контакт додано до списку.');
  } catch (error) {
    $('#contact-error').textContent = error.message; $('#contact-error').classList.remove('d-none');
    for (const [key, message] of Object.entries(error.fields || {})) {
      const input = event.target.elements[key];
      if (input) { input.classList.add('is-invalid'); $(`[data-error-for="${key}"]`).textContent = message; }
    }
  } finally { $('#save-contact').disabled = false; }
});
$('#contact-rows').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]');
  if (edit) editContact(state.contacts.find(contact => contact._id === edit.dataset.edit));
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const contact = state.contacts.find(item => item._id === remove.dataset.delete);
    state.deleteId = contact._id;
    $('#delete-description').textContent = `${fullName(contact)} · ${contact.email}`;
    deleteModal.show();
  }
});
$('#confirm-delete').addEventListener('click', async () => {
  $('#confirm-delete').disabled = true;
  try { await api(`/contacts/${state.deleteId}`, { method: 'DELETE' }); deleteModal.hide(); await loadContacts(); notify('Контакт вилучено зі списку.'); }
  catch (error) { deleteModal.hide(); showError(error); }
  finally { $('#confirm-delete').disabled = false; }
});
$('#contact-rows').addEventListener('change', event => {
  if (!event.target.matches('.contact-check')) return;
  if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
  renderContacts(); renderRecipients();
});
$('#select-page').addEventListener('change', event => {
  visibleContacts().forEach(contact => { if (event.target.checked) state.selected.add(contact._id); else state.selected.delete(contact._id); });
  renderContacts(); renderRecipients();
});
$('#clear-selection').addEventListener('click', () => { state.selected.clear(); renderContacts(); renderRecipients(); });
$('#write-selected').addEventListener('click', () => { $('input[name="audience"][value="selected"]').checked = true; location.hash = 'compose'; renderRecipients(); });
$('#recipient-picker').addEventListener('change', event => {
  if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
  renderContacts(); updateCompose();
});
for (const selector of ['#search', '#sort']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => { state.page = 1; renderContacts(); });
$('#previous-page').addEventListener('click', () => { state.page -= 1; renderContacts(); });
$('#next-page').addEventListener('click', () => { state.page += 1; renderContacts(); });
$('#message-template').addEventListener('change', event => useTemplate(event.target.value));
for (const selector of ['#subject', '#message-text']) $(selector).addEventListener('input', () => { $('#message-template').value = ''; updateCompose(); });
document.querySelectorAll('input[name="audience"]').forEach(input => input.addEventListener('change', updateCompose));
$('#template-cards').addEventListener('click', event => { const button = event.target.closest('[data-template]'); if (button) { useTemplate(button.dataset.template); location.hash = 'compose'; } });
$('#compose-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.sending) return;
  const payload = { audience: $('input[name="audience"]:checked').value, recipientIds: [...state.selected],
    templateId: $('#message-template').value || null, subject: $('#subject').value, text: $('#message-text').value };
  clearError(); state.sending = true; $('#compose-fields').disabled = true; $('#send-progress').classList.remove('d-none'); updateCompose();
  try {
    const campaign = await api('/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    await loadHistory(); showCampaign(campaign);
  } catch (error) { showError(error); }
  finally { state.sending = false; $('#compose-fields').disabled = false; $('#send-progress').classList.add('d-none'); updateCompose(); }
});
$('#refresh-history').addEventListener('click', () => loadHistory().catch(showError));
$('#history-rows').addEventListener('click', event => { const button = event.target.closest('[data-campaign]'); if (button) api(`/campaigns/${button.dataset.campaign}`).then(showCampaign).catch(showError); });
window.addEventListener('hashchange', route);

async function initialize() {
  const [config, templates] = await Promise.all([api('/config'), api('/templates')]);
  state.config = config; state.templates = templates;
  const preview = config.mailMode === 'preview';
  $('#mode-badge').innerHTML = `<i class="bi bi-${preview ? 'eye' : 'broadcast'}" aria-hidden="true"></i>${preview ? 'Локальний перегляд' : 'Надсилання через SMTP'}`;
  $('#mail-mode-note').textContent = preview ? 'Режим перегляду: застосунок створить файли .eml для кожного одержувача. Їх можна завантажити з історії. Листи в Інтернет не надсилаються.' : 'Режим SMTP: після натискання кнопки листи буде надіслано вибраним одержувачам.';
  $('#send-button').innerHTML = `<i class="bi bi-send me-2" aria-hidden="true"></i>${preview ? 'Підготувати листи' : 'Надіслати листи'}`;
  $('#preview-from').textContent = config.mailFrom;
  renderTemplates(); await Promise.all([loadContacts(), loadHistory()]);
  document.body.classList.add('connected'); $('#connection-label').textContent = 'MongoDB підключено';
  route();
}
route();
initialize().catch(error => { $('#connection-label').textContent = 'Сервер недоступний'; $('#contact-rows').innerHTML = '<tr><td class="empty-state" colspan="4">Не вдалося завантажити контакти. Оновіть сторінку після відновлення сервера.</td></tr>'; showError(error); });
