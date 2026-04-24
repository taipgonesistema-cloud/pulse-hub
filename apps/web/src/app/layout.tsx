import type { Metadata } from "next";
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
  title: "ether command | Atendimento Omnichannel",
  description:
    "Dashboard operacional para conectar multiplos numeros de WhatsApp via QR code e evoluir para Instagram e Facebook.",
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
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
