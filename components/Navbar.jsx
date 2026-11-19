"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import LanguageSelector from "@/components/LanguageSelector";

export default function Navbar() {
  const t = useTranslations("Nav");
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav${scrolled ? " nav--solid" : ""}`}>
      <div className="nav__inner">
        <Link href="/" className="nav__logo" aria-label="Vestora home">
          <svg width="22" height="26" viewBox="0 0 27 30" fill="none">
            <path d="M2 4L11 24L20 4" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 12L20 4L25 9" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
          </svg>
          estora
        </Link>

        <nav className="nav__links">
          <Link href="/#product">{t("product")}</Link>
          <Link href="/#investments">{t("pricing")}</Link>
          <Link href="/#markets">Markets</Link>
          <Link href="/#crypto">Crypto</Link>
          <Link href="/#about">{t("about")}</Link>
        </nav>

        <div className="nav__actions">
          <LanguageSelector />
          <NextLink href="/login" className="nav__signin">{t("signIn")}</NextLink>
          <motion.a
            href="/signup"
            className="nav__cta"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {t("getStarted")}
          </motion.a>
          <button
            type="button"
            className="nav__menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="nav__mobile" aria-label="Mobile navigation">
          <Link href="/#product" onClick={() => setMenuOpen(false)}>{t("product")}</Link>
          <Link href="/#investments" onClick={() => setMenuOpen(false)}>{t("pricing")}</Link>
          <Link href="/#markets" onClick={() => setMenuOpen(false)}>Markets</Link>
          <Link href="/#crypto" onClick={() => setMenuOpen(false)}>Crypto</Link>
          <Link href="/#about" onClick={() => setMenuOpen(false)}>{t("about")}</Link>
          <NextLink href="/login" onClick={() => setMenuOpen(false)}>{t("signIn")}</NextLink>
          <NextLink href="/signup" className="nav__mobile-cta" onClick={() => setMenuOpen(false)}>{t("getStarted")}</NextLink>
        </nav>
      )}
    </header>
  );
}