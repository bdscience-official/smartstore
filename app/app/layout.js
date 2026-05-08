import "./globals.css";

export const metadata = {
  title: "스마트스토어 유입 대시보드",
  description: "광고 vs 오가닉 성과 추적",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
