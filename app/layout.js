import "./globals.css";
import { UserProvider } from "@/contexts/UserContext";
import Script from "next/script";

export const metadata = {
  title: "vestora",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <Script id="dashboard-theme-init" strategy="beforeInteractive">
          {`try {
            const theme = window.localStorage.getItem("vestora-dashboard-theme");
            document.documentElement.dataset.dashboardTheme = theme === "dark" ? "dark" : "light";
          } catch {
            document.documentElement.dataset.dashboardTheme = "light";
          }`}
        </Script>
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}