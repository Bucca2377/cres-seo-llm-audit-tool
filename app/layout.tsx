import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRES Marketing Intelligence Hub",
  description:
    "SEO and LLM search ranking audits for multifamily properties. Built on Claude.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
