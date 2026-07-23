import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const locales = ["ja", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ja";

export default getRequestConfig(async () => {
  const jar = await cookies();
  const raw = jar.get("ayanote_locale")?.value;
  const locale: Locale = raw === "en" || raw === "ja" ? raw : defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
