import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng",
  description: `Điều khoản sử dụng dịch vụ ${BRAND.name}.`,
};

const sections: LegalSection[] = [
  { title: "Phạm vi áp dụng", paragraphs: [
    "Điều khoản này điều chỉnh việc truy cập và sử dụng website, ứng dụng, trình phát video và các tính năng liên quan của Lumio. Khi tạo tài khoản hoặc tiếp tục sử dụng dịch vụ, bạn xác nhận đã đọc và đồng ý với các điều khoản này.",
    "Nếu không đồng ý, vui lòng ngừng sử dụng dịch vụ. Một số tính năng hoặc nội dung có thể có điều kiện riêng được thông báo tại thời điểm sử dụng."
  ]},
  { title: "Tài khoản và bảo mật", paragraphs: [
    "Bạn cần cung cấp thông tin chính xác, giữ bí mật mật khẩu và chịu trách nhiệm đối với hoạt động phát sinh từ tài khoản của mình. Hãy thông báo cho Lumio khi phát hiện truy cập trái phép.",
    "Bạn không được chia sẻ, mua bán hoặc cho thuê tài khoản trái với giới hạn gói dịch vụ. Lumio có thể yêu cầu xác minh hoặc tạm khóa phiên đăng nhập khi phát hiện dấu hiệu lạm dụng."
  ]},
  { title: "Nội dung miễn phí và gói thành viên", paragraphs: [
    "Người dùng có tài khoản Lumio có thể xem nội dung đã xuất bản mà không bắt buộc mua gói. Tài khoản miễn phí hiện bị giới hạn chất lượng phát tối đa 720p và một luồng phát đồng thời. Gói thành viên mở khóa chất lượng cao hơn và thêm luồng phát theo thông tin hiển thị tại trang Gói dịch vụ.",
    "Danh mục nội dung, độ phân giải và khả năng phát có thể thay đổi theo quyền phân phối, tình trạng kỹ thuật và thiết bị. Việc hiển thị một tựa phim không đồng nghĩa Lumio bảo đảm tựa phim luôn khả dụng."
  ]},
  { title: "Thanh toán, gia hạn và hoàn tiền", paragraphs: [
    "Giá, thời hạn và quyền lợi của từng gói được hiển thị trước khi bạn xác nhận thanh toán. Thanh toán trực tuyến được xử lý qua đối tác payOS; gói chỉ được kích hoạt sau khi Lumio xác minh thông báo thanh toán hợp lệ từ máy chủ đối tác.",
    "Các gói hiện được thanh toán trước theo từng kỳ và không tự động trừ tiền để gia hạn. Khi hết thời hạn, tài khoản trở về quyền xem miễn phí; bạn chủ động mua kỳ tiếp theo nếu muốn tiếp tục sử dụng quyền lợi trả phí.",
    "Không đóng trình duyệt hoặc tạo giao dịch lặp lại khi giao dịch đang chờ xác nhận. Nếu bị trừ tiền nhưng gói chưa được kích hoạt, hãy gửi mã giao dịch và bằng chứng thanh toán cho bộ phận hỗ trợ.",
    "Chính sách hủy, hoàn tiền và xử lý giao dịch nhầm được áp dụng theo quy định pháp luật có liên quan và chính sách của đơn vị thanh toán. Lumio không cam kết hoàn tiền tự động cho mọi trường hợp."
  ]},
  { title: "Hành vi bị cấm", paragraphs: [
    "Bạn không được can thiệp trình phát, dò quét hoặc khai thác lỗ hổng, vượt cơ chế xác thực, trích xuất hay phân phối lại nội dung trái phép, gây gián đoạn hệ thống hoặc sử dụng dịch vụ cho mục đích vi phạm pháp luật."
  ]},
  { title: "Quyền sở hữu trí tuệ", paragraphs: [
    "Tên thương hiệu, giao diện, phần mềm và các tài sản do Lumio tự tạo thuộc quyền của chủ sở hữu tương ứng. Nội dung phim, hình ảnh, nhạc và tài liệu của bên thứ ba thuộc quyền của chủ sở hữu hoặc bên cấp phép tương ứng.",
    "Không nội dung nào trong dịch vụ trao cho bạn quyền tải xuống, sao chép, phát lại công khai hoặc khai thác thương mại nếu chưa có sự cho phép hợp pháp."
  ]},
  { title: "Giới hạn và thay đổi dịch vụ", paragraphs: [
    "Lumio nỗ lực duy trì dịch vụ ổn định nhưng không bảo đảm hoạt động liên tục, không lỗi hoặc tương thích với mọi thiết bị. Việc bảo trì, sự cố hạ tầng hoặc thay đổi quyền nội dung có thể làm gián đoạn một phần dịch vụ.",
    "Điều khoản có thể được cập nhật để phản ánh thay đổi về sản phẩm hoặc pháp luật. Phiên bản mới được đăng tại trang này cùng ngày cập nhật."
  ]},
  { title: "Liên hệ và giải quyết yêu cầu", paragraphs: [
    "Khi cần hỗ trợ về tài khoản, thanh toán hoặc điều khoản, vui lòng dùng thông tin liên hệ được công bố trên Lumio. Các tranh chấp được ưu tiên giải quyết thông qua trao đổi thiện chí và theo pháp luật Việt Nam trong phạm vi áp dụng."
  ]}
];

export default function TermsPage() {
  return <LegalPage title="Điều khoản sử dụng" intro="Các quy tắc cơ bản khi truy cập và sử dụng nền tảng xem phim Lumio." updatedAt="17/11/2026" sections={sections} />;
}
