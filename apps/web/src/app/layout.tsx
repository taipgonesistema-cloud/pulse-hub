import type { Metadata } from "next";
import { I18nProvider } from "@/i18n/i18n-provider";
import "./globals.css";

const themeInitScript = `(() => {
  try {
    const storageKey = 'pulse-hub.theme';
    const storedTheme = window.localStorage.getItem(storageKey);
    const theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  }
})();`;

export const metadata: Metadata = {
  title: "ether command | Omnichannel Support",
  description:
    "Operational dashboard for connecting multiple WhatsApp numbers via QR code and evolving toward Instagram and Facebook.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-US" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
