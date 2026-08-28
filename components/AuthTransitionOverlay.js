"use client";

import { motion, AnimatePresence } from "framer-motion";
import { LoadingLogo } from "@/components/LoadingLogo";

/**
 * Full-screen blur shown the instant Sign in is clicked. The page behind
 * (login form, etc.) stays visible but blurred — this is NOT a solid
 * cover screen. Just the V mark pulses on top while the request runs.
 */
export default function AuthTransitionOverlay({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="auth-transition-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.22)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <motion.div
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          >
            <LoadingLogo size={64} color="#1F6F4A"/>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}