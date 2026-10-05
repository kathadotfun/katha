import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Katha — Nepali Art & Real World Assets",
  description:
    "Nepali cultural art as Real World Assets, preserving artist authorship, cultural stories and verifiable provenance.",
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
