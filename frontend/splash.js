// Indeterminate progress sweep for the startup splash while main.js waits for
// the backend health check. The window is closed as soon as the app is ready.
import { gsap } from "./node_modules/gsap/index.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const bar = document.querySelector(".splash__bar");

if (bar && !reduceMotion) {
  gsap.fromTo(bar, { xPercent: -100 }, {
    xPercent: 250,
    duration: 1.2,
    ease: "power2.inOut",
    repeat: -1,
  });
}
