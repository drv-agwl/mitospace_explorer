import ReactGA from "react-ga4";

export const initializeGA = (measurementId: string) => {
  ReactGA.initialize(measurementId);
};

export const trackPageView = (path: string) => {
  ReactGA.send({ hitType: "pageview", page: path, title: document.title });
};

export const trackEvent = (category: string, action: string, label?: string) => {
  ReactGA.event({
    category,
    action,
    label,
  });
};