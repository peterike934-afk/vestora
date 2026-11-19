import Hero from "@/components/Hero";
import TrustedLogos from "@/components/TrustedLogos";
import Features from "@/components/Features";
import FeaturesGrid from "@/components/FeaturesGrid";
import DashboardShowcase from "@/components/DashboardShowcase";
import WhyVestora from "@/components/WhyVestora";
import Performance from "@/components/Performance";
import Pricing from "@/components/Pricing";
import FAQ from "@/components/FAQ";
import FinalCta from "@/components/FinalCta";
import TradingSection from "@/components/TradingSection";
import CryptoSection from "@/components/CryptoSection";
import HowItWorks from "@/components/HowItWorks";
import { LandingMarketDataProvider } from "@/components/LandingMarketDataProvider";

export default function LandingPage() {
  return (
    <LandingMarketDataProvider>
    <>
      <div className="hero-trust-wrap">
        <Hero />
        <TrustedLogos />
      </div>
      <Features />
      <Pricing />
      <TradingSection />
      <CryptoSection />
      <HowItWorks />
      <FeaturesGrid />
      <DashboardShowcase />
      <WhyVestora />
      <Performance />
      <FAQ />
      <FinalCta />
    </>
    </LandingMarketDataProvider>
  );
}
