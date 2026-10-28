export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Bản ghi') => new AppError(404, 'NOT_FOUND', `${what} không tồn tại`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
