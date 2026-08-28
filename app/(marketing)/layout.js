import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import GuestChatWidget from "@/components/GuestChatWidget";

export default function MarketingLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <Footer />
      <GuestChatWidget />
    </>
  );
}