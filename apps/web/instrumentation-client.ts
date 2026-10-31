import posthog from "posthog-js";

if (["dbdeck.dev", "www.dbdeck.dev"].includes(location.hostname)) {
  posthog.init("phc_OfnyhqJebenu0IyGsHWlkz02sLT3hxgIcDug4KjcP0O", {
    api_host: "https://eu.i.posthog.com",
    defaults: "2026-08-30",
    capture_exceptions: true,
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest('a[href^="https://dashboard.dbdeck.dev"]')) {
      posthog.capture("dashboard_opened", null, { send_instantly: true, transport: "sendBeacon" });
    }
  });
}
