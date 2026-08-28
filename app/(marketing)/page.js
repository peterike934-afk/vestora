import Hero from "@/components/Hero";
import TrustedLogos from "@/components/TrustedLogos";
import Features from "@/components/Features";
import FeaturesGrid from "@/components/FeaturesGrid";
import DashboardShowcase from "@/components/DashboardShowcase";
import WhyVestora from "@/components/WhyVestora";
import Performance from "@/components/Performance";
import Testimonials from "@/components/Testimonials";
import Pricing from "@/components/Pricing";
import FAQ from "@/components/FAQ";

export default function LandingPage() {
  return (
    <>
      <div className="hero-trust-wrap">
        <Hero />
        <TrustedLogos />
      </div>
      <Features />
      <FeaturesGrid />
      <DashboardShowcase />
      <WhyVestora />
      <Performance />
      <Testimonials />
      <Pricing />
      <FAQ />
    </>
  );
}
