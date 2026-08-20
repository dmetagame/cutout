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
    { autoAlpha: 0.86, y: 12 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.32,
      ease: ENTER_EASE,
      overwrite: "auto",
      clearProps: "opacity,transform,visibility",
    },
  );
  if (items.length > 0) {
    timeline.fromTo(
      items,
      { autoAlpha: 0.9, y: 6 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.26,
        stagger: 0.03,
        ease: ENTER_EASE,
        overwrite: "auto",
        clearProps: "opacity,transform,visibility",
      },
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
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.46,
          stagger: 0.055,
          ease: ENTER_EASE,
          clearProps: "opacity,transform,visibility",
        },
      );

      const sections = gsap.utils.toArray<HTMLElement>("[data-motion-section]", root);
      sections.forEach((section) => {
        ScrollTrigger.create({
          trigger: section,
          start: "clamp(top 92%)",
          once: true,
          onEnter: () => {
            gsap.fromTo(
              section,
              { autoAlpha: 0.88, y: 14 },
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.42,
                ease: ENTER_EASE,
                overwrite: "auto",
                clearProps: "opacity,transform,visibility",
              },
            );
          },
        });
      });
    });
    const stage = root.querySelector<HTMLElement>(".workflow-stage");
    const rail = root.querySelector<HTMLElement>(".flow-rail-shell");
    const desktopMotion = window.matchMedia(`(min-width: 1024px) and ${ENHANCED_MOTION_QUERY}`);
    let pin: ScrollTrigger | null = null;

    const clearPin = () => {
      pin?.kill();
      pin = null;
      if (rail !== null) gsap.set(rail, { clearProps: "all" });
    };

    const configurePin = () => {
      clearPin();
      if (!desktopMotion.matches || stage === null || rail === null) return;

      pin = ScrollTrigger.create({
        trigger: stage,
        start: "top 82px",
        end: "bottom top+=150",
        pin: rail,
        pinSpacing: false,
        anticipatePin: 1,
      });
      ScrollTrigger.refresh();
    };

    configurePin();
    desktopMotion.addEventListener("change", configurePin);

    return () => {
      desktopMotion.removeEventListener("change", configurePin);
      clearPin();
      media.revert();
    };
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
          { scale: 0.9 },
          { scale: 1, duration: 0.28, ease: ENTER_EASE, overwrite: "auto" },
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
      ScrollTrigger.refresh();
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
