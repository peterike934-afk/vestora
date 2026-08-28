"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav${scrolled ? " nav--solid" : ""}`}>
      <div className="nav__inner">
        <a href="/" className="nav__logo" aria-label="Vestora home">
          <svg width="22" height="26" viewBox="0 0 27 30" fill="none">
            <path d="M2 4L11 24L20 4" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 12L20 4L25 9" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
          </svg>
          estora
        </a>
<nav className="nav__links">
  <a href="/#product">Product</a>
  <a href="/#pricing">Pricing</a>
  <a href="/#about">About</a>
</nav>

        <div className="nav__actions">
          <Link href="/login" className="nav__signin">Sign in</Link>
          <motion.a
            href="/signup"
            className="nav__cta"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Get started
          </motion.a>
        </div>
      </div>
    </header>
  );
}