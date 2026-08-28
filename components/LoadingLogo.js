"use client";

import { motion } from "framer-motion";

/**
 * Animated Vestora "V" mark, used anywhere the app needs a loading state
 * instead of a generic spinner — login/signup submit, page transitions,
 * async fetches, etc.
 *
 * Usage:
 *   <LoadingLogo />                → inline, default size (28px), for buttons
 *   <LoadingLogo size={48} />      → larger, for empty-state/page loaders
 *   <LoadingScreen />              → full-page centered overlay
 *   <LoadingScreen label="Signing you in…" />
 */
export function LoadingLogo({ size = 28, color = "var(--green)" }) {
  const width = size;
  const height = (size * 30) / 27; // preserves the logo's original aspect ratio

  return (
    <motion.svg
      width={width}
      height={height}
      viewBox="0 0 27 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      role="status"
      aria-label="Loading"
    >
      <motion.path
        d="M2 4L11 24L20 4"
        stroke={color}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.9, repeat: Infinity, repeatType: "loop", ease: "easeInOut" }}
      />
      <motion.path
        d="M16 12L20 4L25 9"
        stroke={color}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.4 }}
        transition={{ duration: 0.9, repeat: Infinity, repeatType: "loop", ease: "easeInOut", delay: 0.15 }}
      />
    </motion.svg>
  );
}

/**
 * Full-page loading overlay — drop this in anywhere you'd otherwise
 * render "Loading…" text or block the page while an async check runs
 * (auth check, maintenance-mode check, initial data fetch, etc).
 */
export function LoadingScreen({ label }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        background: "var(--bg)",
      }}
    >
      <LoadingLogo size={40} />
      {label && (
        <div style={{ fontSize: "13.5px", color: "var(--ink-muted, var(--text2))" }}>
          {label}
        </div>
      )}
    </div>
  );
}

export default LoadingLogo;