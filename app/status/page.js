"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useReveal } from "@/hooks/useReveal";
import {
  getServiceStatuses, getUptimeHistory, getActiveIncidents,
  getIncidentHistory, subscribeToStatusChanges,
} from "@/lib/queries";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const heroContainer = { hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } };
const heroItem = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } } };

function overallStatus(services, activeIncidents) {
  if (activeIncidents.some(i => i.impact === 'critical')) return { label: 'Major outage', tone: 'down' };
  if (activeIncidents.some(i => i.impact === 'major')) return { label: 'Partial outage', tone: 'down' };
  if (activeIncidents.length || services.some(s => s.currentStatus === 'degraded')) return { label: 'Degraded performance', tone: 'degraded' };
  if (services.some(s => s.currentStatus === 'down')) return { label: 'Partial outage', tone: 'down' };
  return { label: 'All systems operational', tone: 'up' };
}

function UptimeBar({ days }) {
  return (
    <div className="status-bar">
      {days.map((d, i) => <div key={i} className={`status-bar__cell status-bar__cell--${d}`} />)}
    </div>
  );
}

function ServiceRow({ service, index }) {
  const ref = useRef(null);
  const { staggerChild } = useReveal(ref);
  return (
    <motion.div className="status-row" ref={ref} animate={staggerChild(index)}>
      <div className="status-row__top">
        <div className="status-row__left">
          <span className={`status-row__dot status-row__dot--${service.currentStatus}`} />
          <span className="status-row__name">{service.name}</span>
        </div>
        <span className={`status-row__pill status-row__pill--${service.currentStatus}`}>
          {service.currentStatus === 'up' ? 'Operational'
            : service.currentStatus === 'degraded' ? 'Degraded'
            : service.currentStatus === 'down' ? 'Down'
            : 'No data yet'}
        </span>
      </div>
      <UptimeBar days={service.uptime} />
      <div className="status-row__range"><span>90 days ago</span><span>Today</span></div>
    </motion.div>
  );
}

function IncidentCard({ incident }) {
  return (
    <div className="incident-card">
      <div className="incident-card__head">
        <span className={`incident-card__impact incident-card__impact--${incident.impact}`}>
          {incident.impact}
        </span>
        <h3 className="incident-card__title">{incident.title}</h3>
      </div>
      {incident.affected.length > 0 && (
        <p className="incident-card__affected">Affecting: {incident.affected.join(", ")}</p>
      )}
      <div className="incident-card__timeline">
        {incident.updates.map(u => (
          <div className="incident-update" key={u.id}>
            <span className="incident-update__status">{u.status}</span>
            <p className="incident-update__body">{u.body}</p>
            <span className="incident-update__time">
              {new Date(u.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatusPage() {
  const [services, setServices] = useState([]);
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [pastIncidents, setPastIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  const listRef = useRef(null);

  async function loadAll() {
    const svc = await getServiceStatuses();
    const withHistory = await Promise.all(
      svc.map(async (s) => ({ ...s, uptime: await getUptimeHistory(s.id, 90) }))
    );
    setServices(withHistory);
    setActiveIncidents(await getActiveIncidents());
    setPastIncidents(await getIncidentHistory(90));
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    const unsubscribe = subscribeToStatusChanges(() => loadAll());
    return unsubscribe;
  }, []);

  const overall = overallStatus(services, activeIncidents);

  return (
    <>
      <Navbar />
      <main className="status-page">
        <section className="status-hero">
          <motion.div className="status-hero__inner" variants={heroContainer} initial="hidden" animate="show">
            <motion.p className="status-hero__eyebrow" variants={heroItem}>Status</motion.p>
            <motion.div className={`status-banner status-banner--${overall.tone}`} variants={heroItem}>
              <span className="status-banner__dot" />
              <span className="status-banner__text">{loading ? "Checking systems…" : overall.label}</span>
              <span className="status-banner__time">
                Updated {new Date().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            </motion.div>
          </motion.div>
        </section>

        <section className="status-body">
          <div className="status-body__inner" ref={listRef}>
            {activeIncidents.length > 0 && (
              <div className="incident-group">
                <div className="incident-group__head">
                  <AlertTriangle size={16} />
                  <h3>Active incidents</h3>
                </div>
                {activeIncidents.map(inc => <IncidentCard incident={inc} key={inc.id} />)}
              </div>
            )}

            <div className="status-list">
              {services.map((s, i) => <ServiceRow service={s} index={i} key={s.id} />)}
            </div>

            <div className="status-history-section">
              <h3 className="status-history-section__title">Past incidents (90 days)</h3>
              {pastIncidents.length === 0 ? (
                <div className="status-history">
                  <div className="status-history__icon"><CheckCircle2 size={18} /></div>
                  <div>
                    <h3 className="status-history__title">No incidents reported</h3>
                    <p className="status-history__text">Nothing to report in the last 90 days.</p>
                  </div>
                </div>
              ) : (
                pastIncidents.map(inc => <IncidentCard incident={inc} key={inc.id} />)
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}