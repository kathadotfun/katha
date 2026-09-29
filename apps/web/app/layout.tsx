import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Katha",
  description: "A provenance and ownership platform for Nepal's cultural art.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
