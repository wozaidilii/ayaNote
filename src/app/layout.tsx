import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { IBM_Plex_Sans, Noto_Sans_JP } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const plex = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex",
});

const noto = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-noto",
});

export const metadata: Metadata = {
  title: "AyaNote / アヤノート",
  description: "Lesson memory workspace for Japanese 1v1 teachers",
};

/** Run near JP users + Neon APAC (was iad1 → Singapore round-trip). */
export const preferredRegion = "hnd1";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${plex.variable} ${noto.variable} antialiased`} style={{ fontFamily: "var(--font-plex), var(--font-noto), sans-serif" }}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
