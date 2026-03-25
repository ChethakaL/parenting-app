import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./theme-refresh.css";

const plusJakartaSans = localFont({
  src: "./fonts/PlusJakartaSans-Variable.ttf",
  variable: "--wai-font-sans",
  display: "swap",
  weight: "200 800",
});

export const metadata: Metadata = {
  title: "Parent AI",
  description: "Assistant-first household food management for parents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={plusJakartaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
