// heartbeat.js — keeps the local blog server alive only while a page is open.
//
// The server runs in the background (no terminal, no Dock process to quit), so
// it needs to know when you have actually stopped using it. Every open blog
// page pings /internal/alive on a timer; when the last tab is closed the pings
// stop and the server shuts itself down after a short idle window. Switching to
// another app (e.g. the GitHub authorization page) is fine — the timer keeps
// running, and we also ping immediately whenever the tab becomes visible again.
//
// This file is loaded ONLY by the live local server's pages. The exported
// static site (GitHub Pages) never includes it.
(function () {
  "use strict";

  var URL = "/internal/alive";
  var EVERY = 20000; // 20s; server idle timeout is ~75s, so a couple of misses are ok.

  function ping() {
    // keepalive lets the ping survive a tab being backgrounded/closed briefly.
    try {
      fetch(URL, { method: "GET", cache: "no-store", keepalive: true }).catch(function () {});
    } catch (e) { /* server gone / offline — nothing to do */ }
  }

  ping();                       // announce this page immediately
  setInterval(ping, EVERY);     // ...and keep it alive while open

  // Coming back to a throttled/hidden tab: refresh the heartbeat at once so we
  // never sit near the idle limit right after the user returns.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") ping();
  });
})();
