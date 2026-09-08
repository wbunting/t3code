import RFB from "@novnc/novnc";

const desktop = document.getElementById("desktop");
const status = document.getElementById("status");
const disconnect = document.getElementById("disconnect");
const token = location.hash.slice(1);
if (desktop && status && disconnect) {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    status.textContent = "Open the VM desktop from the thread header.";
    disconnect.hidden = true;
  } else {
    const url = new URL(`api/vm-console/${token}`, location.href);
    url.hash = "";
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const rfb = new RFB(desktop, url.href);
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.addEventListener("connect", () => {
      status.textContent = "Connected · you can control this desktop";
    });
    rfb.addEventListener("disconnect", () => {
      status.textContent = "Disconnected. Reopen the console from the thread header to reconnect.";
      disconnect.hidden = true;
    });
    disconnect.addEventListener("click", () => rfb.disconnect());
    window.addEventListener("pagehide", () => rfb.disconnect());
  }
}
