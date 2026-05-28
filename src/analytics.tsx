import ReactGA from "react-ga4";

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? "";
let gaInitialized = false;

export const trackPageView = (path: string) => {
  if (!gaInitialized) return;
  ReactGA.send({ hitType: "pageview", page: path, title: document.title });
};

export const trackEvent = (category: string, action: string, label?: string) => {
  if (!gaInitialized) return;
  ReactGA.event({
    category,
    action,
    label,
  });
};

export const initializeGA = () => {
  if (!GA_MEASUREMENT_ID || gaInitialized) return false;
  ReactGA.initialize(GA_MEASUREMENT_ID);
  gaInitialized = true;
  return true;
};