import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Literata, Zen_Maru_Gothic } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const display = Literata({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Zen_Maru_Gothic({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "AyaNote / アヤノート",
  description: "Lesson memory and prep desk for Japanese 1v1 teachers",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${display.variable} ${body.variable} antialiased`}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
