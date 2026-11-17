import type { Metadata, Viewport } from "next";
import "./voucher-app.css";

export const metadata: Metadata = {
  title: "VoucherApp — Sistem Manajemen Voucher",
  description:
    "Sistem manajemen voucher hotspot MikroTik — generate, monitor, dan kelola voucher secara real-time. Data tersimpan di Supabase.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
