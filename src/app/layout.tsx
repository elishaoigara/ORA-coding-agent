import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORA — Coding Agent",
  description: "ORA: Your AI coding agent with GitHub integration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}