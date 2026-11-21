"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock3, X } from "lucide-react";
import VestoraMark from "@/components/VestoraMark";

function ContactlessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 8.5a5 5 0 0 1 0 7" />
      <path d="M11 6a8.5 8.5 0 0 1 0 12" />
      <path d="M14.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

function PreviewChip() {
  return (
    <svg className="vestora-card-preview__chip" viewBox="0 0 54 42" aria-hidden="true">
      <defs>
        <linearGradient id="vestora-chip-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE7A0" />
          <stop offset=".48" stopColor="#D8A943" />
          <stop offset="1" stopColor="#F4D174" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="52" height="40" rx="8" fill="url(#vestora-chip-gold)" stroke="#FFE9A7" strokeWidth="1.2" />
      <rect x="8" y="7" width="38" height="28" rx="5" fill="none" stroke="#9D7429" strokeOpacity=".8" />
      <path d="M19 7v9h16V7M19 35v-9h16v9M8 16h11v10H8m38-10H35v10h11M27 16v10" fill="none" stroke="#9D7429" strokeWidth="1.15" strokeLinejoin="round" />
    </svg>
  );
}

export default function VestoraCardFeature({ t, cardholder }) {
  const [isNoticeOpen, setIsNoticeOpen] = useState(false);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const wasNoticeOpenRef = useRef(false);

  useEffect(() => {
    if (!isNoticeOpen) {
      if (wasNoticeOpenRef.current) {
        wasNoticeOpenRef.current = false;
        triggerRef.current?.focus();
      }
      return undefined;
    }

    wasNoticeOpenRef.current = true;
    closeRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") setIsNoticeOpen(false);
      if (event.key === "Tab") {
        const focusable = document.querySelectorAll(
          ".vestora-card-notice button:not([disabled])",
        );
        if (focusable.length < 2) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isNoticeOpen]);

  return (
    <>
      <section className="dashboard-vestora-card-feature" aria-label={t("cardFeatureTitle")}>
        <div className="vestora-card-preview" aria-label={t("cardPreviewLabel")}>
          <div className="vestora-card-preview__glow" aria-hidden="true" />
          <div className="vestora-card-preview__pattern" aria-hidden="true" />
          <div className="vestora-card-preview__top">
            <div className="vestora-card-preview__brand">
              <VestoraMark size={29} />
              <span>Vestora</span>
            </div>
            <div className="vestora-card-preview__preview-tag">{t("cardPreviewOnly")}</div>
          </div>

          <div className="vestora-card-preview__hardware">
            <PreviewChip />
            <span className="vestora-card-preview__contactless"><ContactlessIcon /></span>
          </div>

          <div className="vestora-card-preview__number" aria-label={t("cardNumberMasked")}>
            •••• <span>••••</span> <span>••••</span> <span>••••</span>
          </div>

          <div className="vestora-card-preview__bottom">
            <div className="vestora-card-preview__holder">
              <span>{t("cardholderLabel")}</span>
              <strong>{cardholder || t("cardholderPlaceholder")}</strong>
            </div>
            <div className="vestora-card-preview__expiry">
              <span>{t("cardExpiryLabel")}</span>
              <strong>MM/YY</strong>
            </div>
            <div className="vestora-card-preview__mark" aria-hidden="true">V</div>
          </div>
        </div>

        <div className="dashboard-vestora-card-prompt">
          <div className="dashboard-vestora-card-prompt__status">
            <Clock3 size={14} aria-hidden="true" />
            <span>{t("cardComingSoon")}</span>
          </div>
          <h2 className="dashboard-vestora-card-prompt__title">{t("cardFeatureTitle")}</h2>
          <p className="dashboard-vestora-card-prompt__description">{t("cardFeatureDescription")}</p>
          <button
            ref={triggerRef}
            className="dashboard-vestora-card-prompt__button"
            type="button"
            onClick={() => setIsNoticeOpen(true)}
          >
            <span>{t("applyForCard")}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
          <p className="dashboard-vestora-card-prompt__footnote">{t("cardPreviewDisclaimer")}</p>
        </div>
      </section>

      {isNoticeOpen && (
        <div
          className="vestora-card-notice-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsNoticeOpen(false);
          }}
        >
          <section
            className="vestora-card-notice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vestora-card-notice-title"
            aria-describedby="vestora-card-notice-description"
          >
            <button
              ref={closeRef}
              className="vestora-card-notice__close"
              type="button"
              aria-label={t("closeCardNotice")}
              onClick={() => setIsNoticeOpen(false)}
            >
              <X size={19} aria-hidden="true" />
            </button>
            <div className="vestora-card-notice__icon"><Clock3 size={23} aria-hidden="true" /></div>
            <div className="vestora-card-notice__eyebrow">{t("cardComingSoon")}</div>
            <h2 className="vestora-card-notice__title" id="vestora-card-notice-title">{t("cardNoticeTitle")}</h2>
            <p className="vestora-card-notice__description" id="vestora-card-notice-description">{t("cardNoticeMessage")}</p>
            <button
              className="vestora-card-notice__done"
              type="button"
              onClick={() => setIsNoticeOpen(false)}
            >
              {t("closeCardNotice")}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
