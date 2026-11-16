import { HttpError } from '../errors.js';
import { messageInput } from '../validation.js';
import { templates } from '../data/templates.js';

export class CampaignService {
  #busy = false;
  constructor(contacts, campaigns, mailer, config) { Object.assign(this, { contacts, campaigns, mailer, config }); }
  async send(input) {
    const message = messageInput(input, templates);
    if (this.#busy) throw new HttpError(409, 'Зачекайте завершення поточної розсилки.');
    this.#busy = true;
    try {
      const contacts = message.audience === 'all' ? await this.contacts.list() : await this.contacts.findByIds(message.recipientIds);
      if (message.audience === 'selected' && contacts.length !== message.recipientIds.length) {
        throw new HttpError(400, 'Деякі контакти вже видалено. Оновіть список одержувачів.');
      }
      if (!contacts.length) throw new HttpError(400, 'Список одержувачів порожній. Додайте контакти.');
      if (contacts.length > this.config.maxRecipients) throw new HttpError(400, `За одну розсилку можна вибрати до ${this.config.maxRecipients} одержувачів.`);
      const campaign = await this.campaigns.create({
        subject: message.subject, text: message.text, templateId: message.templateId,
        mode: this.config.mailMode, status: 'sending', createdAt: new Date(), finishedAt: null,
        total: contacts.length, succeeded: 0, failed: 0,
        recipients: contacts.map(contact => ({ contactId: String(contact._id), email: contact.email,
          name: `${contact.lastName} ${contact.firstName} ${contact.middleName}`, status: 'pending' }))
      });
      // Кожен лист має окремого одержувача. Результат зберігаємо після кожної спроби.
      for (const [index, contact] of contacts.entries()) {
        let result;
        try {
          result = await this.mailer.send(contact, message, String(campaign._id));
          campaign.succeeded += 1;
        } catch (error) {
          result = { status: 'failed', error: error.code === 'EAUTH' ? 'Помилка автентифікації SMTP.' : 'Не вдалося передати або зберегти листа. Перевірте поштові налаштування.' };
          campaign.failed += 1;
        }
        Object.assign(campaign.recipients[index], result);
        await this.campaigns.update(String(campaign._id), { recipients: campaign.recipients, succeeded: campaign.succeeded, failed: campaign.failed });
      }
      campaign.status = campaign.failed === 0 ? 'completed' : campaign.succeeded === 0 ? 'failed' : 'partial';
      campaign.finishedAt = new Date();
      await this.campaigns.update(String(campaign._id), { status: campaign.status, finishedAt: campaign.finishedAt });
      return campaign;
    } finally { this.#busy = false; }
  }
}
