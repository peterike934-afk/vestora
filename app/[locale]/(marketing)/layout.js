import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import GuestChatWidget from "@/components/GuestChatWidget";

export default async function MarketingLayout({ children, params }) {
  const { locale } = await params;
  if (!routing.locales.includes(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider messages={messages}>
      <div dir={dir}>
        <Navbar />
        <main>{children}</main>
        <Footer />
        <GuestChatWidget />
      </div>
    </NextIntlClientProvider>
  );
}