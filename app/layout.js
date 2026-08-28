import "./globals.css";
import { UserProvider } from "@/contexts/UserContext";

export const metadata = {
  title: "vestora",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}