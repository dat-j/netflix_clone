"use client";

import { Plus } from "lucide-react";
import { Accordion } from "radix-ui";
import { BRAND } from "@/lib/brand";

const FAQ = [
  {
    q: `${BRAND.name} là gì?`,
    a: `${BRAND.name} là dịch vụ xem phim trực tuyến với kho phim lẻ, phim bộ, phim hoạt hình và phim tài liệu đa dạng, xem được trên trình duyệt máy tính, điện thoại và máy tính bảng.\n\nBạn có thể xem bao nhiêu tùy thích, bất cứ lúc nào bạn muốn, không có quảng cáo.`,
  },
  {
    q: `Xem ${BRAND.name} tốn bao nhiêu tiền?`,
    a: "Mỗi gói có mức giá cố định hàng tháng, khác nhau ở chất lượng hình ảnh và số thiết bị xem cùng lúc. Không phát sinh phí ẩn và không cần hợp đồng.",
  },
  {
    q: "Tôi có thể xem ở đâu?",
    a: "Xem ở mọi nơi, mọi lúc trên trình duyệt web của máy tính, điện thoại thông minh và máy tính bảng. Ứng dụng cho TV và di động sẽ sớm ra mắt.",
  },
  {
    q: "Làm thế nào để kích hoạt gói?",
    a: `Thanh toán trực tuyến sẽ sớm được mở. Trong thời gian này, sau khi đăng ký tài khoản, hãy liên hệ ${BRAND.supportEmail} hoặc ${BRAND.supportPhone} để được kích hoạt gói ngay.`,
  },
  {
    q: "Tôi có thể xem gì?",
    a: `${BRAND.name} có thư viện phong phú gồm phim truyện, phim bộ, phim tài liệu, anime và nhiều nội dung khác. Nội dung mới được cập nhật hằng tuần.`,
  },
  {
    q: `${BRAND.name} có phù hợp cho trẻ em không?`,
    a: "Hồ sơ trẻ em mang đến trải nghiệm riêng cho các bé với nội dung phù hợp lứa tuổi, trong khi cha mẹ vẫn dùng hồ sơ của mình.",
  },
];

export function Faq() {
  return (
    <Accordion.Root type="single" collapsible className="space-y-2">
      {FAQ.map((item, i) => (
        <Accordion.Item key={i} value={`q${i}`} className="overflow-hidden">
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 bg-[#2d2d2d] px-6 py-5 text-left text-[clamp(1.05rem,1.5vw,1.5rem)] transition-colors hover:bg-[#414141]">
              {item.q}
              <Plus className="size-8 shrink-0 transition-transform duration-300 group-data-[state=open]:rotate-45 md:size-10" strokeWidth={1.25} />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden bg-[#2d2d2d] text-[clamp(1rem,1.4vw,1.4rem)] leading-relaxed data-[state=closed]:animate-[accordion-up_.25s_ease-out] data-[state=open]:animate-[accordion-down_.3s_cubic-bezier(.16,1,.3,1)]">
            <div className="mt-px border-t border-black px-6 py-6 whitespace-pre-line">{item.a}</div>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
