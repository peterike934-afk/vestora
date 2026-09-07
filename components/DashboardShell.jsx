"use client";

import { useState, useEffect } from "react";
import NextLink from "next/link";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, LayoutDashboard, PieChart, Wallet,
  ArrowDownToLine, ArrowUpFromLine, Settings, Mail, TrendingUp,
  Activity, ShieldCheck, Sun, Moon, LineChart, Gift,
} from "lucide-react";
import ChatWidget from "@/components/ChatWidget";
import { getSettings, getUnreadUserMessageCount, subscribeToMessageCountChanges, getPendingTransactionCount, subscribeToPendingTransactionChanges, getUnreadGuestMessageCount, subscribeToGuestMessageCountChanges } from "@/lib/queries";
import { useLocale } from "next-intl";
import { useUser } from "@/contexts/UserContext";
import { updatePreferredLocale } from "@/lib/queries";


const nav = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/portfolio", icon: PieChart, key: "portfolio" },
  { to: "/markets", icon: LineChart, key: "markets" },
  { to: "/wallet", icon: Wallet, key: "wallet" },
  { to: "/deposit", icon: ArrowDownToLine, key: "deposit" },
  { to: "/withdraw", icon: ArrowUpFromLine, key: "withdraw" },
  { to: "/referrals", icon: Gift, key: "referrals" },
  { to: "/settings", icon: Settings, key: "settings" },
];

const SIDEBAR_WIDTH = 240;
const SIDEBAR_WIDTH_COLLAPSED = 76;
const ICON_SIZE = 18;
const THEME_STORAGE_KEY = "vestora-dashboard-theme";

const s = {
  layout: { display: "flex", minHeight: "100vh" },
  sidebar: {
    background: "var(--bg2)", borderRight: "1px solid var(--border)",
    display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0,
    height: "100vh", zIndex: 200, overflowY: "auto", overflowX: "hidden",
    scrollbarWidth: "none", msOverflowStyle: "none",
  },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 150,
  },
  hamburgerBtn: {
    display: "none",
    position: "fixed", top: "16px", left: "16px", zIndex: 250,
    width: "40px", height: "40px", borderRadius: "10px",
    background: "var(--bg2)", border: "1px solid var(--border)",
    alignItems: "center", justifyContent: "center", cursor: "pointer",
  },
  collapseBtn: {
    position: "fixed", top: "28px", zIndex: 210,
    width: "26px", height: "26px", borderRadius: "50%",
    background: "var(--bg2)", border: "1px solid var(--border)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", color: "var(--text2)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  },
  logo: { padding: "28px 24px 24px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid var(--border)", overflow: "hidden" },
  logoCollapsed: { padding: "28px 0 24px", justifyContent: "center" },
  logoText: { fontFamily: "Playfair Display, serif", fontSize: "18px", fontWeight: "600", color: "var(--text)", whiteSpace: "nowrap" },
  navList: { padding: "16px 12px", flex: 1, display: "flex", flexDirection: "column", gap: "4px" },
  link: { display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: "14px", fontWeight: "500", color: "var(--text2)", transition: "background 0.15s, color 0.15s", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", border: "none", background: "transparent", cursor: "pointer", width: "100%", textAlign: "left", font: "inherit" },
  linkCollapsed: { justifyContent: "center", padding: "10px 0" },
  linkActive: { color: "var(--text)", background: "var(--bg4)" },
  icon: { display: "flex", alignItems: "center", justifyContent: "center", width: "20px", flexShrink: 0 },
  bottom: { padding: "16px 12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "4px" },
  avatar: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "var(--radius-sm)", cursor: "pointer", overflow: "hidden" },
  avatarCollapsed: { justifyContent: "center", padding: "10px 0" },
  avatarImg: { width: "32px", height: "32px", borderRadius: "50%", background: "var(--purple-dim)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "600", color: "var(--purple)", flexShrink: 0 },
  avatarName: { fontSize: "13px", fontWeight: "500", color: "var(--text)", whiteSpace: "nowrap" },
  avatarSub: { fontSize: "11px", color: "var(--text3)", whiteSpace: "nowrap" },
  main: { flex: 1, minHeight: "100vh", background: "var(--bg)", minWidth: 0, transition: "margin-left 0.25s ease" },
  maintenancePage: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "24px", textAlign: "center" },
  maintenanceIcon: { fontSize: "40px", marginBottom: "16px" },
  maintenanceTitle: { fontSize: "22px", fontWeight: "700", color: "var(--text)", marginBottom: "8px" },
  maintenanceSub: { fontSize: "14px", color: "var(--text2)", maxWidth: "360px" },
  navLinkRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  badge: {
    background: "var(--red)", color: "#fff", fontSize: "11px", fontWeight: "700",
    minWidth: "18px", height: "18px", borderRadius: "999px", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0,
  },
  badgeBlue: {
    background: "#2E7BE0", color: "#fff", fontSize: "11px", fontWeight: "700",
    minWidth: "18px", height: "18px", borderRadius: "999px", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0,
  },
  badgeGroup: { display: "flex", alignItems: "center", gap: "4px" },
  badgeDot: {
    position: "absolute", top: "4px", right: "10px",
    width: "8px", height: "8px", borderRadius: "50%", background: "var(--red)",
    border: "2px solid var(--bg2)",
  },
  badgeDotBlue: {
    position: "absolute", top: "4px", right: "20px",
    width: "8px", height: "8px", borderRadius: "50%", background: "#2E7BE0",
    border: "2px solid var(--bg2)",
  },
};

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function VestoraMark({ size = 22 }) {
  const width = size;
  const height = (size * 30) / 27;
  return (
    <svg width={width} height={height} viewBox="0 0 27 30" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M2 4L11 24L20 4" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 12L20 4L25 9" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

// `plain` items (admin) always use next/link so they NEVER get a locale
// prefix — admin isn't localized, so an /es/admin/... URL would 404.
function NavLink({ href, Icon, label, active, collapsed, badgeCount, badgeCountBlue, gold, plain }) {
  const LinkComponent = plain ? NextLink : Link;
  return (
    <LinkComponent
      href={href}
      title={collapsed ? label : undefined}
      style={{
        ...s.link,
        ...(collapsed ? s.linkCollapsed : s.navLinkRow),
        ...(active ? s.linkActive : {}),
        ...(gold ? { color: "var(--gold)" } : {}),
        position: "relative",
      }}
    >
      {collapsed ? (
        <span style={s.icon}><Icon size={ICON_SIZE} strokeWidth={1.75} /></span>
      ) : (
        <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={s.icon}><Icon size={ICON_SIZE} strokeWidth={1.75} /></span>
          {label}
        </span>
      )}

      {collapsed ? (
        <>
          {badgeCountBlue > 0 && <span style={s.badgeDotBlue} />}
          {badgeCount > 0 && <span style={s.badgeDot} />}
        </>
      ) : (
        <span style={s.badgeGroup}>
          {badgeCountBlue > 0 && (
            <span style={s.badgeBlue}>{badgeCountBlue > 99 ? "99+" : badgeCountBlue}</span>
          )}
          {badgeCount > 0 && (
            <span style={s.badge}>{badgeCount > 99 ? "99+" : badgeCount}</span>
          )}
        </span>
      )}
    </LinkComponent>
  );
}

function ThemeSwitch({ theme, onToggle, collapsed, t }) {
  const isLight = theme === "light";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      onClick={onToggle}
      title={collapsed ? (isLight ? t("switchToDark") : t("switchToLight")) : undefined}
      style={{
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        gap: "10px", padding: collapsed ? "10px 0" : "10px 14px",
        borderRadius: "var(--radius-sm)", background: "transparent", border: "none",
        cursor: "pointer", width: "100%", color: "var(--text2)",
        fontSize: "14px", fontWeight: 500, font: "inherit",
      }}
    >
      {!collapsed && (
        <span>{isLight ? t("lightMode") : t("darkMode")}</span>
      )}
      <span
        style={{
          position: "relative", width: "40px", height: "22px", borderRadius: "999px",
          background: "var(--bg4)", border: "1px solid var(--border)", flexShrink: 0,
        }}
      >
        <motion.span
          animate={{ x: isLight ? 19 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          style={{
            position: "absolute", top: "1px", left: 0, width: "18px", height: "18px",
            borderRadius: "50%", background: "var(--green)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          }}
        >
          {isLight ? <Sun size={12} strokeWidth={2} /> : <Moon size={12} strokeWidth={2} />}
        </motion.span>
      </span>
    </button>
  );
}

export default function DashboardShell({ profile, children }) {
  const t = useTranslations("DashboardShell");
  const router = useRouter();
  const pathname = usePathname();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [checkedMaintenance, setCheckedMaintenance] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [guestUnreadCount, setGuestUnreadCount] = useState(0);
  const [pendingTxnCount, setPendingTxnCount] = useState(0);
  const [isDesktop, setIsDesktop] = useState(true);
  const [theme, setTheme] = useState("dark");
  const locale = useLocale();
  const { user } = useUser();

  const displayName = profile?.full_name || t("defaultInvestorName");
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    getSettings()
      .then(s => setMaintenanceMode(s.maintenance_mode))
      .catch(err => console.error("Failed to load settings:", err))
      .finally(() => setCheckedMaintenance(true));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  function toggleTheme() {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    setIsDesktop(mq.matches);
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isAdmin) return;
    function refreshCount() {
      getUnreadUserMessageCount()
        .then(setUnreadCount)
        .catch(err => console.error("Failed to load unread message count:", err));
    }
    refreshCount();
    const unsubscribe = subscribeToMessageCountChanges(refreshCount);
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    function refreshGuestCount() {
      getUnreadGuestMessageCount()
        .then(setGuestUnreadCount)
        .catch(err => console.error("Failed to load unread guest count:", err));
    }
    refreshGuestCount();
    const unsubscribe = subscribeToGuestMessageCountChanges(refreshGuestCount);
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    function refreshPendingCount() {
      getPendingTransactionCount()
        .then(setPendingTxnCount)
        .catch(err => console.error("Failed to load pending transaction count:", err));
    }
    refreshPendingCount();
    const unsubscribe = subscribeToPendingTransactionChanges(refreshPendingCount);
    return unsubscribe;
  }, [isAdmin]);

  if (checkedMaintenance && maintenanceMode && !isAdmin) {
    return (
      <div style={s.maintenancePage}>
        <div style={s.maintenanceIcon}>🛠️</div>
        <div style={s.maintenanceTitle}>{t("maintenanceTitle")}</div>
        <p style={s.maintenanceSub}>{t("maintenanceSub")}</p>
      </div>
    );
  }

  useEffect(() => {
  if (!user?.id || isAdmin) return;
  updatePreferredLocale(user.id, locale).catch(err =>
    console.error("Failed to sync preferred locale:", err)
  );
}, [locale, user?.id, isAdmin]);

  const sidebarX = !isDesktop ? (mobileMenuOpen ? 0 : "-100%") : 0;
  const collapsed = isDesktop && sidebarCollapsed;
  const sidebarWidth = !isDesktop ? SIDEBAR_WIDTH : (collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH);
  const mainMarginLeft = isDesktop ? sidebarWidth : 0;
  const collapseBtnLeft = `${sidebarWidth - 13}px`;

  return (
    <motion.div
      className={`dashboard-scope ${theme === "light" ? "theme-light" : ""}`}
      style={s.layout}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <button
        className="mobile-hamburger"
        style={s.hamburgerBtn}
        onClick={() => setMobileMenuOpen(v => !v)}
        aria-label={t("toggleMenu")}
      >
        <span style={{ fontSize: "20px", color: "var(--text)" }}>{mobileMenuOpen ? "✕" : "☰"}</span>
      </button>

      {isDesktop && (
        <motion.button
          className="sidebar-collapse-btn"
          style={s.collapseBtn}
          animate={{ left: collapseBtnLeft }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          onClick={() => setSidebarCollapsed(v => !v)}
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </motion.button>
      )}

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            className="mobile-overlay"
            style={s.overlay}
            onClick={() => setMobileMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      <motion.aside
        className="app-sidebar"
        style={s.sidebar}
        animate={{ x: sidebarX, width: sidebarWidth }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        <div style={{ ...s.logo, ...(collapsed ? s.logoCollapsed : {}) }}>
          <VestoraMark size={collapsed ? 20 : 22} />
          {!collapsed && <span style={s.logoText}>Vestora</span>}
        </div>
        <nav style={s.navList}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              href={item.to}
              Icon={item.icon}
              label={t(`nav.${item.key}`)}
              active={pathname === item.to}
              collapsed={collapsed}
            />
          ))}
          {isAdmin && (
            <>
              <div style={{ marginTop: "auto" }}>
                <NavLink
                  plain
                  href="/admin/messages"
                  Icon={Mail}
                  label="Messages"
                  active={pathname === "/admin/messages"}
                  collapsed={collapsed}
                  badgeCount={unreadCount}
                  badgeCountBlue={guestUnreadCount}
                />
              </div>
              <NavLink
                plain
                href="/admin/investments"
                Icon={TrendingUp}
                label="Investments"
                active={pathname === "/admin/investments"}
                collapsed={collapsed}
              />

              <NavLink
                plain
                href="/admin/referrals"
                Icon={Gift}
                label="Referrals"
                active={pathname === "/admin/referrals"}
                collapsed={collapsed}
              />

              <NavLink
                plain
                href="/admin/system-status"
                Icon={Activity}
                label="Status"
                active={pathname === "/admin/system-status"}
                collapsed={collapsed}
              />
              <NavLink
                plain
                href="/admin/settings"
                Icon={Settings}
                label="Platform settings"
                active={pathname === "/admin/settings"}
                collapsed={collapsed}
              />
              <NavLink
                plain
                href="/admin"
                Icon={ShieldCheck}
                label="Admin"
                active={pathname === "/admin"}
                collapsed={collapsed}
                badgeCount={pendingTxnCount}
                gold
              />
            </>
          )}
        </nav>
        <div style={s.bottom}>
          <ThemeSwitch theme={theme} onToggle={toggleTheme} collapsed={collapsed} t={t} />
          <div
            style={{ ...s.avatar, ...(collapsed ? s.avatarCollapsed : {}) }}
            onClick={() => router.push("/settings")}
            title={collapsed ? displayName : undefined}
          >
            <div style={s.avatarImg}>{getInitials(displayName)}</div>
            {!collapsed && (
              <div>
                <div style={s.avatarName}>{displayName}</div>
                <div style={s.avatarSub}>{isAdmin ? t("adminRole") : t("investorRole")}</div>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      <main className="app-main" style={{ ...s.main, marginLeft: `${mainMarginLeft}px` }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      {!isAdmin && <ChatWidget />}
    </motion.div>
  );
}