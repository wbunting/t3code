# Thread monitors

Hover over a Pi thread in the sidebar to check its monitors, including when none
are active.

When Pi has an active monitor, the thread header shows a blue indicator. Between
turns, it reads **Waiting · monitor active**; while Pi is working, it reads
**Monitor active**. Hover over the indicator to see the monitor names.

The indicator follows Pi's monitor status updates. It disappears when the last
monitor stops or the Pi session ends. A monitor may remain active after it fires
if it was configured to keep watching.
If the connection drops, the indicator turns gray and labels the status as
disconnected until the connection returns.

This indicator is available in the web and desktop clients for Pi sessions with
the Pi Monitor extension. Other providers and the mobile client do not currently
show it.
