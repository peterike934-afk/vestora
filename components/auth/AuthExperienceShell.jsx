import Link from "next/link";
import VestoraMark from "@/components/VestoraMark";

export default function AuthExperienceShell({ children, className = "", topAction }) {
  return (
    <div className="dashboard-scope">
      <main className={`auth-experience ${className}`}>
        <aside className="auth-experience__brand-panel">
          <div className="auth-experience__brand-panel-glow" aria-hidden="true" />
          <Link className="auth-experience__brand" href="/" aria-label="Vestora home">
            <span className="auth-experience__brand-mark"><VestoraMark size={30} /></span>
            <span>Vestora</span>
          </Link>

          <div className="auth-experience__brand-copy">
            <span className="auth-experience__eyebrow">A clearer view of your finances</span>
            <h1>Your financial world, in clearer view.</h1>
            <p>
              A thoughtful place to manage your investment account and take your next steps.
            </p>
          </div>

          <div className="auth-experience__visual" aria-hidden="true">
            <svg viewBox="0 0 560 500" fill="none">
              <defs>
                <radialGradient id="auth-orbit-glow" cx="0" cy="0" r="1" gradientTransform="translate(280 250) rotate(90) scale(210)">
                  <stop stopColor="#52D88B" stopOpacity=".23" />
                  <stop offset="1" stopColor="#52D88B" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="auth-orbit-line" x1="72" y1="122" x2="474" y2="395">
                  <stop stopColor="#A0F0BE" stopOpacity=".62" />
                  <stop offset="1" stopColor="#2AC979" stopOpacity=".13" />
                </linearGradient>
              </defs>
              <circle cx="280" cy="250" r="210" fill="url(#auth-orbit-glow)" />
              <ellipse cx="280" cy="250" rx="203" ry="78" transform="rotate(-28 280 250)" stroke="url(#auth-orbit-line)" />
              <ellipse cx="280" cy="250" rx="203" ry="78" transform="rotate(35 280 250)" stroke="url(#auth-orbit-line)" strokeOpacity=".65" />
              <ellipse cx="280" cy="250" rx="130" ry="204" transform="rotate(12 280 250)" stroke="url(#auth-orbit-line)" strokeOpacity=".4" />
              <circle cx="280" cy="250" r="128" stroke="#B6F3C9" strokeOpacity=".12" />
              <circle cx="280" cy="250" r="92" stroke="#B6F3C9" strokeOpacity=".12" />
              <circle cx="148" cy="180" r="5" fill="#9DEDB8" />
              <circle cx="427" cy="184" r="4" fill="#6EDC99" />
              <circle cx="343" cy="422" r="5" fill="#9DEDB8" />
              <circle cx="221" cy="84" r="3" fill="#C5F8D3" />
              <path d="M92 360c57-26 99-26 144 0 46 27 91 27 141 0 31-17 63-24 96-20" stroke="#C1F4D1" strokeOpacity=".28" />
              <path d="M120 390h320" stroke="#C1F4D1" strokeOpacity=".11" />
            </svg>
            <div className="auth-experience__visual-caption">
              <span className="auth-experience__visual-dot" />
              <span>Built around clarity. Designed for what’s next.</span>
            </div>
          </div>

          <div className="auth-experience__panel-footer">
            <span>Thoughtful investing starts with a clear view.</span>
            <span>© {new Date().getFullYear()} Vestora</span>
          </div>
        </aside>

        <section className="auth-experience__content">
          {topAction && <div className="auth-experience__top-action">{topAction}</div>}
          <div className="auth-experience__form-area">{children}</div>
          <footer className="auth-experience__footer">
            <span>Review Vestora’s</span>
            <span className="auth-experience__legal-links">
              <a href="/legal/terms-of-service.pdf" target="_blank" rel="noreferrer">Terms</a>
              <span aria-hidden="true">·</span>
              <a href="/legal/privacy-policy.pdf" target="_blank" rel="noreferrer">Privacy</a>
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}
