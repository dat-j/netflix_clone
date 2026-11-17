import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Chính sách bản quyền",
  description: `Chính sách tiếp nhận yêu cầu bản quyền của ${BRAND.name}.`,
};

const sections: LegalSection[] = [
  { title: "Quyền đối với nội dung", paragraphs: [
    "Lumio tôn trọng quyền tác giả và quyền liên quan. Phim, chương trình, hình ảnh, poster, nhạc, phụ đề và tài liệu của bên thứ ba thuộc về chủ sở hữu hoặc bên cấp phép tương ứng.",
    "Việc một nội dung xuất hiện trên nền tảng không có nghĩa Lumio tuyên bố sở hữu nội dung đó. Chúng tôi xử lý các yêu cầu có căn cứ và hợp lệ theo quy định pháp luật áp dụng."
  ]},
  { title: "Gửi thông báo vi phạm", paragraphs: [
    "Chủ sở hữu quyền hoặc người đại diện được ủy quyền có thể gửi yêu cầu rà soát nội dung. Để chúng tôi xử lý nhanh và chính xác, vui lòng cung cấp:"
  ], bullets: [
    "Họ tên, tổ chức, thông tin liên hệ và căn cứ chứng minh quyền sở hữu hoặc đại diện.",
    "Mô tả tác phẩm được bảo hộ và tài liệu chứng minh quyền.",
    "URL cụ thể của nội dung bị khiếu nại trên Lumio.",
    "Mô tả rõ hành vi bị cho là xâm phạm và cơ sở pháp lý của yêu cầu.",
    "Cam kết thông tin cung cấp là chính xác và bạn có thẩm quyền gửi yêu cầu."
  ]},
  { title: "Quy trình xử lý", paragraphs: [
    "Sau khi nhận được thông báo đủ thông tin, Lumio sẽ ghi nhận, rà soát và có thể tạm ẩn hoặc hạn chế truy cập nội dung trong thời gian xác minh. Chúng tôi có thể yêu cầu tài liệu bổ sung nếu thông tin chưa đủ để xác định quyền.",
    "Nếu phát hiện nội dung được đăng tải do nhầm lẫn hoặc có căn cứ phản hồi hợp lệ, các bên liên quan có thể gửi tài liệu để Lumio xem xét lại. Việc khôi phục nội dung phụ thuộc kết quả xác minh và quy định pháp luật."
  ]},
  { title: "Thông tin liên hệ", paragraphs: [
    "Gửi yêu cầu bản quyền qua email hỗ trợ được công bố trên website với tiêu đề “Yêu cầu bản quyền”. Không gửi mật khẩu, mã OTP hoặc dữ liệu thanh toán nhạy cảm trong thư.",
    "Lumio có thể từ chối yêu cầu thiếu căn cứ, không xác định được nội dung hoặc có dấu hiệu lạm dụng quy trình khiếu nại."
  ]}
];

export default function CopyrightPage() {
  return <LegalPage title="Chính sách bản quyền" intro="Quy trình để chủ sở hữu quyền gửi yêu cầu rà soát nội dung trên Lumio." updatedAt="17/11/2026" sections={sections} />;
}
