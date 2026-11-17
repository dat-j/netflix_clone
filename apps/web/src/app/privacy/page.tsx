import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư",
  description: `Cách ${BRAND.name} thu thập, sử dụng và bảo vệ dữ liệu cá nhân.`,
};

const sections: LegalSection[] = [
  { title: "Dữ liệu chúng tôi xử lý", paragraphs: [
    "Tùy cách bạn sử dụng dịch vụ, Lumio có thể xử lý email, thông tin tài khoản, mật khẩu đã được băm, hồ sơ xem, tùy chọn hồ sơ, lịch sử xem, đánh giá, danh sách yêu thích, thông tin gói thành viên và lịch sử giao dịch.",
    "Khi bạn đăng nhập hoặc liên kết Telegram, chúng tôi có thể lưu Telegram ID, tên hiển thị, username và trạng thái liên kết để cung cấp tính năng tương ứng.",
    "Hệ thống có thể ghi nhận địa chỉ IP, loại trình duyệt, thiết bị, thời điểm đăng nhập, nhật ký lỗi và dữ liệu kỹ thuật cần thiết để bảo vệ dịch vụ."
  ]},
  { title: "Mục đích sử dụng", bullets: [
    "Tạo và bảo vệ tài khoản, xác thực phiên đăng nhập và quản lý hồ sơ.",
    "Cung cấp phát video, lưu tiến độ xem, đề xuất nội dung và đồng bộ trải nghiệm.",
    "Xử lý thanh toán, kích hoạt gói và hỗ trợ đối soát giao dịch.",
    "Gửi thông báo phim hoặc tập mới qua Telegram khi bạn đã liên kết và bật tùy chọn.",
    "Phát hiện gian lận, xử lý sự cố, cải thiện hiệu năng và đáp ứng nghĩa vụ pháp lý."
  ], paragraphs: []},
  { title: "Cookie và lưu trữ cục bộ", paragraphs: [
    "Lumio sử dụng cookie thiết yếu để duy trì phiên đăng nhập, hồ sơ đang chọn, bảo vệ yêu cầu và hỗ trợ hoạt động của website. Nếu chặn cookie thiết yếu, một số chức năng như đăng nhập hoặc phát video có thể không hoạt động.",
    "Không sử dụng thông tin cookie để bán dữ liệu cá nhân cho nhà quảng cáo."
  ]},
  { title: "Đối tác và bên nhận dữ liệu", paragraphs: [
    "Dữ liệu cần thiết có thể được xử lý bởi nhà cung cấp hạ tầng lưu trữ, phân phối nội dung, cơ sở dữ liệu, giám sát hệ thống, thanh toán payOS và Telegram. Các bên này nhận dữ liệu trong phạm vi cần thiết để cung cấp dịch vụ tương ứng.",
    "Lumio không bán dữ liệu cá nhân của người dùng. Dữ liệu có thể được cung cấp khi có yêu cầu hợp pháp từ cơ quan có thẩm quyền hoặc để bảo vệ quyền và an toàn của người dùng, Lumio và bên thứ ba."
  ]},
  { title: "Thời hạn lưu trữ và bảo mật", paragraphs: [
    "Dữ liệu được lưu trong thời gian cần thiết cho các mục đích nêu trên, để duy trì tài khoản, xử lý tranh chấp hoặc đáp ứng nghĩa vụ pháp lý. Nhật ký kỹ thuật có thể được lưu trong thời hạn ngắn hơn.",
    "Lumio áp dụng các biện pháp kỹ thuật và tổ chức phù hợp như băm mật khẩu, cookie bảo mật, phân quyền truy cập và mã hóa một số khóa media. Tuy vậy, không hệ thống nào có thể bảo đảm an toàn tuyệt đối."
  ]},
  { title: "Quyền của bạn", paragraphs: [
    "Bạn có thể cập nhật thông tin hồ sơ, quản lý phiên đăng nhập, hủy liên kết Telegram và tắt thông báo trong phần Tài khoản. Bạn cũng có thể gửi yêu cầu truy cập, chỉnh sửa hoặc xóa dữ liệu cá nhân theo quy định pháp luật.",
    "Một số dữ liệu giao dịch hoặc nhật ký có thể cần được giữ lại trong phạm vi pháp luật cho phép hoặc yêu cầu."
  ]},
  { title: "Trẻ em và hồ sơ trẻ em", paragraphs: [
    "Hồ sơ trẻ em là tính năng hỗ trợ lọc nội dung theo cài đặt hồ sơ, không thay thế sự giám sát của cha mẹ hoặc người giám hộ. Người tạo tài khoản chịu trách nhiệm quản lý hồ sơ và lựa chọn nội dung phù hợp."
  ]},
  { title: "Thay đổi chính sách và liên hệ", paragraphs: [
    "Chính sách này có thể được cập nhật khi dịch vụ hoặc quy định pháp luật thay đổi. Ngày cập nhật mới nhất sẽ được hiển thị ở đầu trang. Với yêu cầu liên quan đến dữ liệu cá nhân, vui lòng liên hệ bộ phận hỗ trợ của Lumio."
  ]}
];

export default function PrivacyPage() {
  return <LegalPage title="Chính sách quyền riêng tư" intro="Chúng tôi giải thích dữ liệu nào được xử lý, vì sao cần dữ liệu đó và cách bạn có thể quản lý thông tin của mình." updatedAt="17/11/2026" sections={sections} />;
}
