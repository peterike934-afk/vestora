import { useMotionValue, useTransform, useSpring, useInView } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * useReveal — scroll-triggered reveal hook for Vestora.
 *
 * Usage:
 *   const sectionRef = useRef(null);
 *   const { fadeUp, fadeIn } = useReveal(sectionRef);
 *
 *   <section ref={sectionRef}>
 *     <motion.h2 style={fadeUp(0)}>Headline</motion.h2>
 *     <motion.p  style={fadeUp(1)}>Body</motion.p>
 *   </section>
 */
export function useReveal(ref, options = {}) {
  const { once = true, margin = "-80px" } = options;
  const isInView = useInView(ref, { once, margin });

  /**
   * fadeUp(order) — staggered fade + translateY reveal.
   * order: 0 = first element, 1 = second, etc.
   * Returns a style object to spread onto a motion element.
   */
  const fadeUp = (order = 0) => ({
    opacity: isInView ? 1 : 0,
    y: isInView ? 0 : 24,
    transition: {
      duration: 0.6,
      delay: order * 0.1,
      ease: [0.16, 1, 0.3, 1],
    },
  });

  /**
   * fadeIn(order) — fade only, no translateY.
   * Good for full-width or card-grid elements where vertical shift looks odd.
   */
  const fadeIn = (order = 0) => ({
    opacity: isInView ? 1 : 0,
    transition: {
      duration: 0.6,
      delay: order * 0.08,
      ease: "easeOut",
    },
  });

  /**
   * staggerChild(order) — for individual items inside a grid/list.
   * Tighter delay than fadeUp, suitable for many items in sequence.
   */
  const staggerChild = (order = 0) => ({
    opacity: isInView ? 1 : 0,
    y: isInView ? 0 : 20,
    transition: {
      duration: 0.5,
      delay: order * 0.07,
      ease: [0.16, 1, 0.3, 1],
    },
  });

  return { fadeUp, fadeIn, staggerChild, isInView };
}
