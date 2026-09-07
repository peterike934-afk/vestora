import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/DashboardShell";
import enMessages from "@/messages/en.json";

export default async function Layout({ children }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DashboardShell profile={profile}>{children}</DashboardShell>
    </NextIntlClientProvider>
  );
}