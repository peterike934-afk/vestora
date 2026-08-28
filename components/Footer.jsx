const LINKS = [
  {
    heading: "Product",
    items: [
      { label: "Features", href: "/#product" },   // was "#product"
      { label: "Pricing", href: "/#pricing" },    // was "#pricing"
      { label: "Security", href: "/security" },
      
    ],
  },
  {
    heading: "Company",
    items: [
      { label: "About", href: "/#about" },        // was "#about"
     
    ],
  },
  {
    heading: "Legal",
    items: [
      { label: "Privacy Policy", href: "/legal/privacy-policy.pdf", external: true },
      { label: "Terms of Service", href: "/legal/terms-of-service.pdf", external: true },
      { label: "Cookie Policy", href: "/legal/cookie-policy.pdf", external: true },
    ],
  },
  {
    heading: "Support",
    items: [
      { label: "Help center", href: "/#faq" },    // was "#faq"
      { label: "Contact Us", href: "mailto:support@vestora.com" },
      { label: "Status", href: "/status" },
    ],
  },
];

const SOCIALS = [
  {
    label: "WhatsApp",
    href: "https://wa.me/09168383809",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.55-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.78.97-.14.17-.29.19-.53.06-.25-.12-1.05-.38-1.99-1.22-.74-.66-1.24-1.47-1.38-1.72-.15-.24-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.22.24-.87.85-.87 2.07s.89 2.4 1.01 2.57c.13.17 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.19.2-.58.2-1.08.14-1.19-.06-.1-.23-.17-.48-.29z"/>
      </svg>
    ),
  },
  {
    label: "Telegram",
    href: "https://t.me/09168383809",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.94 4.5c.28-1.19-.99-2.15-2.09-1.68L2.5 10.36c-1.2.5-1.15 2.22.08 2.65l4.29 1.5 1.66 5.31c.24.77 1.22.99 1.79.41l2.42-2.44 4.4 3.28c.86.64 2.11.18 2.35-.86L21.94 4.5zM8.6 13.4l9.2-5.98c.29-.19.6.21.36.44l-7.6 7.13a.9.9 0 0 0-.27.53l-.32 2.4-1.37-4.52z"/>
      </svg>
    ),
  },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">

        {/* Top: logo + columns */}
        <div className="footer__top">
          <div className="footer__brand">
            <a href="/" className="footer__logo">
              <svg width="20" height="24" viewBox="0 0 27 30" fill="none">
                <path d="M2 4L11 24L20 4" stroke="#1F6F4A" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 12L20 4L25 9" stroke="#1F6F4A" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
              </svg>
              estora
            </a>
            <p className="footer__tagline">Grow your money with quiet confidence.</p>
            <div className="footer__socials">
              {SOCIALS.map((s) => (
                <a key={s.label} href={s.href} className="footer__social" aria-label={s.label}>
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          <div className="footer__cols">
            {LINKS.map((col) => (
              <div key={col.heading} className="footer__col">
                <p className="footer__col-heading">{col.heading}</p>
 <ul>
  {col.items.map((item) => (
    <li key={item.label}>
      
       <a  href={item.href}
        {...(item.external && { target: "_blank", rel: "noopener noreferrer" })}
      >
        {item.label}
      </a>
    </li>
  ))}
</ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: copyright + disclaimer */}
        <div className="footer__bottom">
          <p className="footer__copy">© {new Date().getFullYear()} Vestora. All rights reserved.</p>
        </div>

      </div>
    </footer>
  );
}
