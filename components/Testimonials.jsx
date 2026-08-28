"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReveal } from "@/hooks/useReveal";

const TESTIMONIALS = [
  {
    quote: "I've tried three other platforms. Vestora is the only one where I actually understand what's happening with my money.",
    name: "Rod O.",
    role: "Freelance designer, Washington, D.C.",
    initials: "AO",
    photo: "/testimonials/rod.jpg",
  },
  {
    quote: "The AI portfolio has returned 14% in eight months. I haven't touched it once — that's exactly what I wanted.",
    name: "James K.",
    role: "insurance agent, London",
    initials: "JK",
    photo: "/testimonials/james.jpg",
  },
  {
    quote: "Starting with $500 felt embarrassing before. Vestora made it feel completely normal. Now I'm at $4,800.",
    name: "Sofia R.",
    role: "Lawyer, Toronto",
    initials: "SR",
    photo: "/testimonials/sofia.jpg",
  },
  {
    quote: "The rebalancing alone has saved me hours every month. It just quietly does its job in the background.",
    name: "Carlos M.",
    role: "Product manager, Austin",
    initials: "CM",
    photo: "/testimonials/carlos.jpg",
  },
  {
    quote: "I recommend Vestora to everyone who tells me investing feels too complicated. It genuinely isn't, here.",
    name: "Stephanie C.",
    role: "Nurse practitioner, Chicago",
    initials: "SC",
    photo: "/testimonials/stephanie.jpg",
  },
  {
    quote: "Clean, fast, and the fees are exactly what they say they are. No surprises after six months of use.",
    name: "Sabasthine W.",
    role: "Consultant, Germany",
    initials: "SW",
    photo: "/testimonials/sabasthine.jpg",
  },
];

function Avatar({ photo, initials, name }) {
  const [failed, setFailed] = useState(false);

  if (photo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt={name}
        onError={() => setFailed(true)}
        className="testimonial-card__avatar-img"
      />
    );
  }

  return <div className="testimonial-card__avatar">{initials}</div>;
}

export default function Testimonials() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <section className="testimonials" ref={ref}>
      <div className="testimonials__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          What investors say
        </motion.p>

        <motion.h2 className="testimonials__headline" animate={fadeUp(1)}>
          Real people.<br />Real returns.
        </motion.h2>

        <div className="testimonials__grid">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              className="testimonial-card"
              animate={staggerChild(i)}
            >
              <p className="testimonial-card__quote">"{t.quote}"</p>
              <div className="testimonial-card__author">
                <Avatar photo={t.photo} initials={t.initials} name={t.name} />
                <div>
                  <p className="testimonial-card__name">{t.name}</p>
                  <p className="testimonial-card__role">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
