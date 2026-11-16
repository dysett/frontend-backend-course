import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pug from 'pug';
import { projectRoot } from '../config.js';

export function createMailer(config) {
  const renderEmail = pug.compileFile(path.join(projectRoot, 'views/emails/message.pug'));
  const transport = nodemailer.createTransport(config.mailMode === 'smtp' ? config.smtp : {
    streamTransport: true, buffer: true, newline: 'windows'
  });
  return {
    async send(contact, message, campaignId) {
      const info = await transport.sendMail({
        from: config.mailFrom,
        to: { name: `${contact.lastName} ${contact.firstName} ${contact.middleName}`, address: contact.email },
        subject: message.subject, text: message.text, html: renderEmail({ subject: message.subject, text: message.text }),
        disableFileAccess: true, disableUrlAccess: true
      });
      if (config.mailMode === 'preview') {
        await mkdir(config.outboxDir, { recursive: true });
        const fileName = `${campaignId}-${contact._id}.eml`;
        await writeFile(path.join(config.outboxDir, fileName), info.message, { flag: 'wx' });
        return { status: 'preview', messageId: info.messageId, fileName };
      }
      if (!info.accepted?.length) throw new Error('SMTP-сервер не прийняв листа.');
      return { status: 'sent', messageId: info.messageId };
    },
    close() { transport.close(); }
  };
}
