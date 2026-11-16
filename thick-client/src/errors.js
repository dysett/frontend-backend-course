export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function invalid(message) {
  return new AppError(400, 'VALIDATION_ERROR', message);
}

export function notFound() {
  return new AppError(404, 'BOOK_NOT_FOUND', 'Книжку не знайдено.');
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === 11000) error = new AppError(409, 'DUPLICATE_ISBN', 'Книжка з таким ISBN уже існує.');
  if (error.type === 'entity.parse.failed') error = invalid('Тіло запиту містить некоректний JSON.');
  if (error.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Тіло запиту перевищує 32 КБ.');
  if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
    error = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Потрібен JSON у кодуванні UTF-8.');
  }
  if (error instanceof URIError) error = invalid('Некоректне кодування URL.');
  if (!(error instanceof AppError)) {
    console.error('Неочікувана помилка сервісу:', error.name);
    error = new AppError(500, 'INTERNAL_ERROR', 'Внутрішня помилка сервісу.');
  }
  const body = { code: error.code, message: error.message };
  if (error.details) body.details = error.details;
  res.status(error.status).json({ error: body });
}
