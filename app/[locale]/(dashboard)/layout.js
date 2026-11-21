import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { FxRatesProvider } from "@/contexts/FxRatesContext";
import DashboardShell from "@/components/DashboardShell";
import { after } from "next/server";
import { isNewlyVerified, sendWelcomeEmailIfNewlyVerified } from "@/lib/welcome-email";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Layout({ children, params }) {
  const { locale } = await params;
  if (!routing.locales.includes(locale)) notFound();
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Covers users who verified on another device or browser and then
  // signed in manually: the callback had no session for them. Runs after
  // the response; the ledger guarantees at most one welcome email.
  if (isNewlyVerified(user)) {
    after(() => sendWelcomeEmailIfNewlyVerified(user));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider messages={messages}>
      <div dir={dir}>
        <FxRatesProvider>
          <DashboardShell profile={profile}>{children}</DashboardShell>
        </FxRatesProvider>
      </div>
    </NextIntlClientProvider>
  );
}