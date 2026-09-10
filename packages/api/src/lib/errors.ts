export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const conflict = (message: string) => new HttpError(409, message);
