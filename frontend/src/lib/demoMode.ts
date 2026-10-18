/** Demo tooling (role switcher, prefilled credentials) is off unless VITE_DEMO_MODE=true at build/dev time. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
