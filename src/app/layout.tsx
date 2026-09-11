import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
