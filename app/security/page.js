"use client";

import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useRef } from "react";
import { useReveal } from "@/hooks/useReveal";
import { Lock, KeyRound, Eye, Landmark } from "lucide-react";

const CUSTODY = [
  { label: "Segregated client accounts", detail: "Assets held apart from Vestora's operating funds, at all times.", status: "Active" },
  { label: "FDIC-insured cash", detail: "Cash balances held at partner banks, insured up to applicable limits.", status: "Active" },
  { label: "Cold storage for crypto", detail: "The large majority of digital assets held offline, not in a hot wallet.", status: "Active" },
  { label: "Independent custodians", detail: "Equities and gold held by regulated third-party custodians, not Vestora itself.", status: "Active" },
];

const ACCOUNT = [
  { label: "Two-factor authentication", detail: "TOTP-based 2FA available on every account, enforced at your choice.", status: "Available" },
  { label: "Encrypted credentials", detail: "Passwords stored as salted hashes — never in plain text, never visible to staff.", status: "Active" },
  { label: "Session monitoring", detail: "Unusual login activity is flagged and can trigger a re-authentication prompt.", status: "Active" },
  { label: "Withdrawal confirmation", detail: "Every withdrawal requires a fresh authentication check before it's processed.", status: "Active" },
];

const INFRA = [
  { label: "Encryption in transit", detail: "All traffic between your device and Vestora is encrypted via TLS.", status: "Active" },
  { label: "Encryption at rest", detail: "Stored data, including financial records, is encrypted at the database layer.", status: "Active" },
  { label: "Role-based access", detail: "Internal staff access is scoped to what each role actually needs — nothing more.", status: "Active" },
  { label: "Continuous monitoring", detail: "Infrastructure and account activity are monitored for anomalies around the clock.", status: "Active" },
];

// Hero: load-in only, no scroll trigger — it's the first thing visible
const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

function StatementGroup({ title, icon: Icon, rows, index }) {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <div className="sec-group" ref={ref}>
      <motion.div className="sec-group__head" animate={fadeUp(0)}>
        <div className="sec-group__icon"><Icon size={16} /></div>
        <h3 className="sec-group__title">{title}</h3>
      </motion.div>
      <div className="sec-rows">
        {rows.map((r, i) => (
          <motion.div className="sec-row" key={r.label} animate={staggerChild(i)}>
            <div className="sec-row__left">
              <div className="sec-row__label">{r.label}</div>
              <div className="sec-row__detail">{r.detail}</div>
            </div>
            <span className="sec-row__status">{r.status}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const discRef = useRef(null);
  const { fadeUp: discFadeUp } = useReveal(discRef);

  return (
    <>
      <Navbar />
      <main className="sec-page">
        <section className="sec-hero">
          <motion.div
            className="sec-hero__inner"
            variants={heroContainer}
            initial="hidden"
            animate="show"
          >
            <motion.p className="sec-hero__eyebrow" variants={heroItem}>
              Security
            </motion.p>
            <motion.h1 className="sec-hero__headline" variants={heroItem}>
              Run like a ledger,<br />not a promise.
            </motion.h1>
            <motion.p className="sec-hero__sub" variants={heroItem}>
              Every safeguard below is either live in your account today or held by a
              regulated third party. Nothing here is aspirational.
            </motion.p>
          </motion.div>
        </section>

        <section className="sec-body">
          <div className="sec-body__inner">
            <StatementGroup title="Custody & asset protection" icon={Landmark} rows={CUSTODY} />
            <StatementGroup title="Account controls" icon={KeyRound} rows={ACCOUNT} />
            <StatementGroup title="Infrastructure & data" icon={Lock} rows={INFRA} />

            <motion.div className="sec-disclosure" ref={discRef} animate={discFadeUp(0)}>
              <div className="sec-disclosure__icon"><Eye size={18} /></div>
              <div>
                <h3 className="sec-disclosure__title">Found a vulnerability?</h3>
                <p className="sec-disclosure__text">
                  We take reports seriously and respond quickly. Reach the security team
                  directly at <a href="mailto:security@vestora.com">security@vestora.com</a>.
                </p>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}