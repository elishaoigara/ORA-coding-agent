import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "ORA — Coding Agent",
  description: "ORA: Your AI coding agent with GitHub integration",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// ORA is intentionally cyberpunk-dark only. Remove legacy light classes and
// persist the locked palette before the first paint to avoid a white flash.
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    document.documentElement.classList.remove('light');
    document.documentElement.style.colorScheme = 'dark';
    localStorage.setItem('codeagent:theme', 'dark');
  } catch (e) { /* localStorage unavailable — CSS still defaults dark */ }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
