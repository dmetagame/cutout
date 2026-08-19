"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const ENHANCED_MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
const ENTER_EASE = "power3.out";

function revealStatePanel(scope: HTMLElement): void {
  const panels = gsap.utils.toArray<HTMLElement>("[data-state-reveal]", scope);
  const panel = panels.at(-1);
  if (panel === undefined) return;

  const items = gsap.utils.toArray<HTMLElement>("[data-motion-item]", panel);
  const timeline = gsap.timeline();
  timeline.fromTo(
    panel,
    { autoAlpha: 0.72, y: 14, scale: 0.994 },
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.34, ease: ENTER_EASE },
  );
  if (items.length > 0) {
    timeline.fromTo(
      items,
      { autoAlpha: 0.78, y: 7 },
      { autoAlpha: 1, y: 0, duration: 0.28, stagger: 0.035, ease: ENTER_EASE },
      "-=0.18",
    );
  }
}

export function useWorkflowMotion(
  scope: RefObject<HTMLElement | null>,
  state: string,
): void {
  useGSAP(() => {
    const root = scope.current;
    if (root === null) return;

    const media = gsap.matchMedia();
    media.add(ENHANCED_MOTION_QUERY, () => {
      const intro = gsap.utils.toArray<HTMLElement>("[data-motion-intro]", root);
      gsap.fromTo(
        intro,
        { autoAlpha: 0, y: 18 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.52,
          stagger: 0.07,
          ease: ENTER_EASE,
          clearProps: "opacity,transform,visibility",
        },
      );

      const sections = gsap.utils.toArray<HTMLElement>("[data-motion-section]", root);
      sections.forEach((section) => {
        gsap.fromTo(
          section,
          { autoAlpha: 0.35, y: 22, scale: 0.992 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.5,
            ease: ENTER_EASE,
            clearProps: "opacity,transform,visibility",
            scrollTrigger: {
              trigger: section,
              start: "top 91%",
              once: true,
            },
          },
        );
      });
    });
    media.add(`(min-width: 1024px) and ${ENHANCED_MOTION_QUERY}`, () => {
      const stage = root.querySelector<HTMLElement>(".workflow-stage");
      const rail = root.querySelector<HTMLElement>(".flow-rail-shell");
      if (stage === null || rail === null) return;

      ScrollTrigger.create({
        trigger: stage,
        start: "top 82px",
        end: "+=96",
        pin: rail,
        pinSpacing: true,
        anticipatePin: 1,
      });
    });

    return () => media.revert();
  }, { scope });

  useGSAP(() => {
    const root = scope.current;
    if (root === null) return;

    const media = gsap.matchMedia();
    media.add(ENHANCED_MOTION_QUERY, () => {
      const activeMarker = root.querySelector<HTMLElement>(".flow-step.is-active .flow-step-marker");
      if (activeMarker !== null) {
        gsap.fromTo(
          activeMarker,
          { scale: 0.82 },
          { scale: 1, duration: 0.36, ease: "back.out(1.7)" },
        );
      }

      const activeLine = root.querySelector<HTMLElement>(".flow-step.is-active .flow-step-progress");
      if (activeLine !== null) {
        gsap.fromTo(
          activeLine,
          { scaleX: 0 },
          { scaleX: 1, duration: 0.48, ease: ENTER_EASE, transformOrigin: "left center" },
        );
      }

      revealStatePanel(root);
    });
    return () => media.revert();
  }, { scope, dependencies: [state], revertOnUpdate: true });
}

export function useReceiptMotion(
  scope: RefObject<HTMLElement | null>,
  status: "loading" | "missing" | "ready",
): void {
  useGSAP(() => {
    const root = scope.current;
    if (root === null) return;

    const media = gsap.matchMedia();
    media.add(ENHANCED_MOTION_QUERY, () => {
      const targets = gsap.utils.toArray<HTMLElement>("[data-receipt-reveal]", root);
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 16, scale: 0.994 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.5,
          stagger: 0.07,
          ease: ENTER_EASE,
          clearProps: "opacity,transform,visibility",
        },
      );
    });
    return () => media.revert();
  }, { scope, dependencies: [status], revertOnUpdate: true });
}
