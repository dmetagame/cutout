"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect, type ReactNode } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function MotionProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    let lenis: Lenis | null = null;
    let tick: ((time: number) => void) | null = null;

    const destroyLenis = () => {
      if (tick !== null) {
        gsap.ticker.remove(tick);
        tick = null;
      }
      lenis?.destroy();
      lenis = null;
    };

    const configureMotion = () => {
      destroyLenis();
      document.documentElement.dataset.motion = media.matches ? "reduced" : "enhanced";

      if (media.matches) {
        ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
        gsap.ticker.lagSmoothing(500, 33);
        return;
      }

      gsap.ticker.lagSmoothing(0);
      lenis = new Lenis({
        anchors: { duration: 0.65, offset: -84 },
        duration: 0.82,
        easing: (time) => 1 - Math.pow(1 - time, 4),
        overscroll: true,
        respectReducedMotion: true,
        smoothWheel: true,
        syncTouch: false,
        touchMultiplier: 1,
        wheelMultiplier: 0.88,
        prevent: (node) => node.closest("[data-lenis-prevent]") !== null,
      });
      lenis.on("scroll", ScrollTrigger.update);
      tick = (time) => lenis?.raf(time * 1_000);
      gsap.ticker.add(tick);
      ScrollTrigger.refresh();
    };

    configureMotion();
    media.addEventListener("change", configureMotion);

    return () => {
      media.removeEventListener("change", configureMotion);
      destroyLenis();
      gsap.ticker.lagSmoothing(500, 33);
      delete document.documentElement.dataset.motion;
    };
  }, []);

  return children;
}
