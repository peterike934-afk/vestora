"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";

const PEOPLE = [
  { name: "Rod O.", initials: "AO", photo: "/testimonials/rod.jpg" },
  { name: "James K.", initials: "JK", photo: "/testimonials/james.jpg" },
  { name: "Sofia R.", initials: "SR", photo: "/testimonials/sofia.jpg" },
  { name: "Carlos M.", initials: "CM", photo: "/testimonials/carlos.jpg" },
  { name: "Stephanie C.", initials: "SC", photo: "/testimonials/stephanie.jpg" },
  { name: "Sabasthine W.", initials: "SW", photo: "/testimonials/sabasthine.jpg" },
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
  const t = useTranslations("Testimonials");
  const items = t.raw("items");

  return (
    <section className="testimonials" ref={ref}>
      <div className="testimonials__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="testimonials__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <div className="testimonials__grid">
          {items.map((item, i) => (
            <motion.div
              key={PEOPLE[i].name}
              className="testimonial-card"
              animate={staggerChild(i)}
            >
              <p className="testimonial-card__quote">"{item.quote}"</p>
              <div className="testimonial-card__author">
                <Avatar photo={PEOPLE[i].photo} initials={PEOPLE[i].initials} name={PEOPLE[i].name} />
                <div>
                  <p className="testimonial-card__name">{PEOPLE[i].name}</p>
                  <p className="testimonial-card__role">{item.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}