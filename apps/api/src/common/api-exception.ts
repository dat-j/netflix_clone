import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@app/shared";
import type { Response } from "express";

/** Ném lỗi theo đúng dạng `ApiError` của contract. */
export class ApiException extends HttpException {
  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super({ statusCode, code, message, details } satisfies ApiError, statusCode);
  }
}

const STATUS_CODE: Record<number, ApiErrorCode> = {
  400: "VALIDATION", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "code" in body) return res.status(status).json(body);
      const message = typeof body === "string" ? body : ((body as { message?: unknown }).message ?? exception.message);
      return res.status(status).json({
        statusCode: status,
        code: STATUS_CODE[status] ?? "INTERNAL",
        message: Array.isArray(message) ? message.join("; ") : String(message),
      } satisfies ApiError);
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return res.status(500).json({ statusCode: 500, code: "INTERNAL", message: "Lỗi máy chủ" } satisfies ApiError);
  }
}
