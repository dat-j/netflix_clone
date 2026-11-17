import type { ApiErrorCode } from "@app/shared";
import { ApiRequestError } from "./errors";

/** Friendly Vietnamese copy for every API error code. */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
  UNAUTHENTICATED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  NOT_FOUND: "Không tìm thấy nội dung bạn yêu cầu.",
  CONFLICT: "Dữ liệu đã thay đổi. Vui lòng thử lại.",
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng. Vui lòng thử lại hoặc đặt lại mật khẩu.",
  EMAIL_TAKEN: "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.",
  TOKEN_INVALID: "Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.",
  PROFILE_REQUIRED: "Vui lòng chọn hồ sơ để tiếp tục.",
  PROFILE_LIMIT: "Bạn đã đạt số hồ sơ tối đa của tài khoản.",
  NO_SUBSCRIPTION: "Không thể xác thực quyền phát. Vui lòng thử lại.",
  TOO_MANY_STREAMS: "Tài khoản của bạn đang được xem trên quá nhiều thiết bị.",
  SESSION_ENDED: "Phiên xem đã kết thúc.",
  NOT_PLAYABLE: "Nội dung này hiện chưa thể phát.",
  RATE_LIMITED: "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.",
  INTERNAL: "Đã có lỗi xảy ra. Vui lòng thử lại sau.",
  TELEGRAM_UNAVAILABLE: "Đăng nhập qua Telegram tạm thời chưa khả dụng. Vui lòng thử lại sau.",
  TELEGRAM_INIT_DATA_INVALID: "Phiên Telegram không hợp lệ hoặc đã hết hạn. Hãy đóng và mở lại BoxPhim từ Telegram.",
  TELEGRAM_LINK_CONFLICT: "Tài khoản Telegram hoặc tài khoản BoxPhim này đã được liên kết với tài khoản khác.",
  PAYMENT_UNAVAILABLE: "Cổng thanh toán chưa được cấu hình. Vui lòng thử lại sau.",
  PAYMENT_PROVIDER_ERROR: "Không thể tạo giao dịch thanh toán. Vui lòng thử lại sau.",
  PAYMENT_SIGNATURE_INVALID: "Thông báo thanh toán không hợp lệ.",
  PAYMENT_AMOUNT_MISMATCH: "Số tiền thanh toán không khớp với đơn hàng.",
};

export function errorMessage(error: unknown, overrides: Partial<Record<ApiErrorCode, string>> = {}): string {
  if (error instanceof ApiRequestError) {
    return overrides[error.code] ?? ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.INTERNAL;
  }
  if (error instanceof TypeError) return "Không thể kết nối máy chủ. Kiểm tra kết nối mạng và thử lại.";
  return ERROR_MESSAGES.INTERNAL;
}

export function isApiError(error: unknown, ...codes: ApiErrorCode[]): error is ApiRequestError {
  return error instanceof ApiRequestError && (codes.length === 0 || codes.includes(error.code));
}
