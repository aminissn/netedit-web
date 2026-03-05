import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NetEdit MVP",
  description: "Web-based SUMO network editor",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white">{children}</body>
    </html>
  );
}
