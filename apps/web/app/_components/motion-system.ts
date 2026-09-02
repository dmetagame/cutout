"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger, Flip);

const ENHANCED_MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
const ENTER_EASE = "power3.out";

const BAND_COLORS = {
  LOW: { foreground: "#087a63", background: "#e5f4ef" },
  MEDIUM: { foreground: "#9a5b08", background: "#fff3d7" },
  HIGH: { foreground: "#a92735", background: "#fdebed" },
} as const;

function containsLiveRegion(element: HTMLElement): boolean {
  return element.matches("[aria-live], [role='status'], [role='alert']")
    || element.querySelector("[aria-live], [role='status'], [role='alert']") !== null;
}

function revealStatePanel(scope: HTMLElement): void {
  const panels = gsap.utils.toArray<HTMLElement>("[data-state-reveal]", scope);
  const panel = panels.at(-1);
  if (panel === undefined || panel.dataset.motionRevealed === "true") return;
  panel.dataset.motionRevealed = "true";

  const timeline = gsap.timeline();
  if (containsLiveRegion(panel)) {
    timeline.fromTo(
      panel,
      { y: 10 },
      {
        y: 0,
        duration: 0.3,
        ease: ENTER_EASE,
        overwrite: "auto",
        clearProps: "transform",
      },
    );
  } else {
    timeline.fromTo(
      panel,
      { opacity: 0.84, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.3,
        ease: ENTER_EASE,
        overwrite: "auto",
        clearProps: "opacity,transform",
      },
    );
  }

  const items = gsap.utils
    .toArray<HTMLElement>("[data-motion-item]", panel)
    .filter((item) => !containsLiveRegion(item));
  if (items.length > 0) {
    timeline.fromTo(
      items,
      { opacity: 0.82, y: 5 },
      {
        opacity: 1,
        y: 0,
        duration: 0.25,
        stagger: 0.035,
        ease: ENTER_EASE,
        overwrite: "auto",
        clearProps: "opacity,transform",
      },
      "-=0.16",
    );
  }
}

function animateBand(root: HTMLElement): void {
  const band = root.querySelector<HTMLElement>("[data-decision-band]");
  const label = root.querySelector<HTMLElement>("[data-decision-label]");
  const nextBand = band?.dataset.decisionBand;
  if (band === null || nextBand !== "LOW" && nextBand !== "MEDIUM" && nextBand !== "HIGH") return;

  const previousBand = root.dataset.motionBand;
  const previousColors = previousBand === "LOW" || previousBand === "MEDIUM" || previousBand === "HIGH"
    ? BAND_COLORS[previousBand]
    : { foreground: "#526675", background: "#edf2f5" };
  const nextColors = BAND_COLORS[nextBand];

  gsap.fromTo(
    band,
    {
      color: previousColors.foreground,
      backgroundColor: previousColors.background,
      y: 4,
      opacity: 0.72,
    },
    {
      color: nextColors.foreground,
      backgroundColor: nextColors.background,
      y: 0,
      opacity: 1,
      duration: 0.38,
      ease: ENTER_EASE,
      overwrite: "auto",
      clearProps: "transform,opacity",
    },
  );
  if (label !== null) {
    gsap.fromTo(
      label,
      { y: 4, opacity: 0.58 },
      {
        y: 0,
        opacity: 1,
        duration: 0.32,
        ease: ENTER_EASE,
        overwrite: "auto",
        clearProps: "transform,opacity",
      },
    );
  }
  root.dataset.motionBand = nextBand;
}

function countEvidenceIntegers(root: HTMLElement): void {
  const counters = gsap.utils
    .toArray<HTMLElement>("[data-count-value]", root)
    .filter((counter) => counter.dataset.motionCounted !== counter.dataset.countValue);

  counters.forEach((counter) => {
    const target = Number(counter.dataset.countValue);
    if (!Number.isSafeInteger(target) || target < 0) return;
    counter.dataset.motionCounted = String(target);
    const value = { current: 0 };
    gsap.to(value, {
      current: target,
      duration: 0.52,
      ease: "power2.out",
      onUpdate: () => {
        counter.textContent = Math.round(value.current).toLocaleString();
      },
      onComplete: () => {
        counter.textContent = target.toLocaleString();
      },
    });
  });
}

function animateFlowMarker(root: HTMLElement): void {
  const activeMarker = root.querySelector<HTMLElement>(".flow-step.is-active .flow-step-marker");
  if (activeMarker === null) return;

  const nextIndex = Number(activeMarker.dataset.flowIndex);
  const previousIndex = Number(root.dataset.motionStep ?? nextIndex);
  const markers = gsap.utils.toArray<HTMLElement>(".flow-step-marker", root);
  const previousMarker = markers.find((marker) => Number(marker.dataset.flowIndex) === previousIndex);
  const offset = previousMarker === undefined || previousIndex === nextIndex
    ? 0
    : previousMarker.getBoundingClientRect().left - activeMarker.getBoundingClientRect().left;

  gsap.fromTo(
    activeMarker,
    { x: offset, scale: 0.94 },
    {
      x: 0,
      scale: 1,
      duration: offset === 0 ? 0.28 : 0.46,
      ease: ENTER_EASE,
      overwrite: "auto",
      clearProps: "transform",
    },
  );
  root.dataset.motionStep = String(nextIndex);

  const activeLine = root.querySelector<HTMLElement>(".flow-step.is-active .flow-step-progress");
  if (activeLine !== null) {
    gsap.fromTo(
      activeLine,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.44,
        ease: ENTER_EASE,
        transformOrigin: "left center",
        clearProps: "transform",
      },
    );
  }
}

export function animateAmountFlip(
  scope: RefObject<HTMLElement | null>,
  updateAmount: () => void,
  afterFlip: () => void,
): void {
  const root = scope.current;
  const target = root?.querySelector<HTMLElement>("[data-proposal-amount]") ?? null;
  if (
    root === null
    || target === null
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    updateAmount();
    afterFlip();
    return;
  }

  const flipState = Flip.getState(target);
  updateAmount();
  window.requestAnimationFrame(() => {
    if (!target.isConnected) {
      afterFlip();
      return;
    }
    let completed = false;
    let fallbackTimer: number | null = null;
    const finish = () => {
      if (completed) return;
      completed = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      afterFlip();
    };
    fallbackTimer = window.setTimeout(finish, 460);
    Flip.from(flipState, {
      duration: 0.38,
      ease: "power2.out",
      scale: false,
      simple: true,
      onComplete: finish,
      onInterrupt: finish,
    });
  });
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
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.56,
          stagger: 0.055,
          ease: ENTER_EASE,
          clearProps: "opacity,transform",
        },
      );

      const sections = gsap.utils
        .toArray<HTMLElement>("[data-motion-section]", root)
        .filter((section) => !section.hasAttribute("data-motion-intro"));
      sections.forEach((section) => {
        ScrollTrigger.create({
          trigger: section,
          start: "clamp(top 90%)",
          once: true,
          onEnter: () => {
            gsap.fromTo(
              section,
              containsLiveRegion(section) ? { y: 12 } : { opacity: 0.86, y: 12 },
              {
                opacity: 1,
                y: 0,
                duration: 0.42,
                ease: ENTER_EASE,
                overwrite: "auto",
                clearProps: "opacity,transform",
              },
            );
          },
        });
      });

      const coverRows = gsap.utils.toArray<HTMLElement>("[data-cover-row]", root);
      if (coverRows.length > 0) {
        ScrollTrigger.create({
          trigger: root.querySelector(".cover-table-wrap"),
          start: "clamp(top 90%)",
          once: true,
          onEnter: () => {
            gsap.fromTo(
              coverRows,
              { opacity: 0, y: 7 },
              {
                opacity: 1,
                y: 0,
                duration: 0.34,
                stagger: 0.045,
                ease: ENTER_EASE,
                clearProps: "opacity,transform",
              },
            );
          },
        });
      }
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
        endTrigger: stage,
        start: "top 76px",
        end: "bottom top+=170",
        pin: rail,
        pinSpacing: false,
        anticipatePin: 1,
      });
      ScrollTrigger.refresh();
    };

    configurePin();
    desktopMotion.addEventListener("change", configurePin);
    let resizeFrame = 0;
    const refreshPinWidth = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(configurePin);
    };
    window.addEventListener("resize", refreshPinWidth);

    return () => {
      desktopMotion.removeEventListener("change", configurePin);
      window.removeEventListener("resize", refreshPinWidth);
      window.cancelAnimationFrame(resizeFrame);
      clearPin();
      media.revert();
    };
  }, { scope });

  useGSAP(() => {
    const root = scope.current;
    if (root === null) return;

    const media = gsap.matchMedia();
    let refreshFrame = 0;
    media.add(ENHANCED_MOTION_QUERY, () => {
      animateFlowMarker(root);
      revealStatePanel(root);
      animateBand(root);
      countEvidenceIntegers(root);

      const signalRows = gsap.utils
        .toArray<HTMLElement>("[data-signal-row]", root)
        .filter((row) => row.dataset.motionSignal !== "true");
      signalRows.forEach((row) => {
        row.dataset.motionSignal = "true";
      });
      if (signalRows.length > 0) {
        gsap.fromTo(
          signalRows,
          { opacity: 0.74, y: 5 },
          {
            opacity: 1,
            y: 0,
            duration: 0.28,
            stagger: 0.04,
            ease: ENTER_EASE,
            clearProps: "opacity,transform",
          },
        );
        const fired = signalRows.filter((row) => row.classList.contains("is-fired"));
        if (fired.length > 0) {
          gsap.fromTo(
            fired,
            {
              backgroundColor: "rgba(180, 35, 45, 0.14)",
              borderColor: "rgba(180, 35, 45, 0.58)",
            },
            {
              backgroundColor: "rgba(180, 35, 45, 0.045)",
              borderColor: "rgba(180, 35, 45, 0.22)",
              duration: 0.72,
              delay: 0.1,
              ease: "power2.out",
              clearProps: "backgroundColor,borderColor",
            },
          );
        }
      }
      refreshFrame = window.requestAnimationFrame(() => ScrollTrigger.refresh());
    });
    return () => {
      window.cancelAnimationFrame(refreshFrame);
      media.revert();
    };
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
      const targets = gsap.utils
        .toArray<HTMLElement>("[data-receipt-reveal]", root)
        .filter((target) => target.dataset.motionReceipt !== "true");
      targets.forEach((target) => {
        target.dataset.motionReceipt = "true";
      });
      const visualTargets = targets.filter((target) => !containsLiveRegion(target));
      const liveTargets = targets.filter(containsLiveRegion);
      const timeline = gsap.timeline();
      if (visualTargets.length > 0) {
        timeline.fromTo(
          visualTargets,
          { opacity: 0, y: 13 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.065,
            ease: ENTER_EASE,
            clearProps: "opacity,transform",
          },
        );
      }
      if (liveTargets.length > 0) {
        timeline.fromTo(
          liveTargets,
          { y: 8 },
          {
            y: 0,
            duration: 0.28,
            ease: ENTER_EASE,
            clearProps: "transform",
          },
          0,
        );
      }
    });
    return () => media.revert();
  }, { scope, dependencies: [status], revertOnUpdate: true });
}
