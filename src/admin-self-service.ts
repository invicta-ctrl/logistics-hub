import "./admin.css";
import { adminPage, confirmImpact } from "./admin-frame";
import { SELF_SERVICE_COPY as COPY, SELF_SERVICE_RULES } from "./setting-copy";
import { api, failure, html, plural, setMessage, toast } from "./ui";

/** Administration > Self-Service: the one switch phones obey, what it changes, and what phones ask for. */
export async function selfServiceSettings(): Promise<void> {
  const session = await adminPage("self-service", {
    title: "Self-Service",
    lede: "Whether people can use their own phones, and what phones ask for.",
    body: (session) => {
      const closed = session.selfServiceClosed;
      return html`
    <section class="admin-block admin-block--first" aria-labelledby="ss-switch-title">
      <h2 id="ss-switch-title" class="section-title">${COPY.label}</h2>
      <p><span class="tag ${closed ? "tag--warn" : "tag--ok"}">${closed ? COPY.closed.state : COPY.open.state}</span></p>
      <p>${closed ? COPY.closed.effect : COPY.open.effect}</p>
      <div class="form-alert" id="ss-alert" role="alert" hidden></div>
      <button type="button" class="button ${closed ? "button--primary" : "button--secondary"}" id="ss-toggle">${closed ? "Reopen Self-Service" : "Close for maintenance"}</button>
      <p class="admin-source">${COPY.source}</p>
    </section>
    <section class="admin-block" aria-labelledby="ss-rules-title">
      <h2 id="ss-rules-title" class="section-title">What phones ask for</h2>
      <p>These rules are the same on every phone and cannot be switched off here.</p>
      <dl class="guide">${SELF_SERVICE_RULES.map((rule) => html`<div><dt>${rule.action}</dt><dd>${rule.asks}</dd></div>`)}</dl>
    </section>
    ${closed ? html`<section class="ss-trial" aria-labelledby="ss-trial-title">
      <h2 id="ss-trial-title" class="section-title">Test Self-Service</h2>
      <p>Self-Service is closed for maintenance, and everyone else sees the maintenance page. Here it works as it would on a phone, but every record you make is held in <a href="/staff/self-service" data-route>Self-Service</a> as a test and changes nothing unless someone applies it. Dismiss your tests there when you are done.</p>
      <iframe class="ss-trial__frame" src="/self-service" title="Self-Service in test mode" loading="lazy"></iframe>
    </section>` : ""}`;
    }
  });
  if (!session) return;
  document.querySelector("#ss-toggle")!.addEventListener("click", async () => {
    const closing = !session.selfServiceClosed;
    const waiting = session.selfServiceReviews;
    const confirmed = await confirmImpact({
      kicker: COPY.label,
      title: closing ? "Close Self-Service for maintenance?" : "Reopen Self-Service?",
      impact: closing
        ? html`<p>Phones show the maintenance screen at once and record nothing until you reopen it. People are sent to DOL staff in person.</p>
          <p>${waiting ? `${plural(waiting, "record")} already waiting for a check stay in Self-Service.` : "Nothing is waiting for a check."} Records waiting on a phone are kept and sent when it reopens.</p>`
        : html`<p>Phones can take, borrow, use and return again at once. Records kept on phones during the closure are sent and wait for staff to check them.</p>`,
      confirm: closing ? "Close for maintenance" : "Reopen Self-Service",
      danger: closing
    });
    if (!confirmed) return;
    try {
      await api("/api/staff/admin/self-service", { method: "PATCH", body: JSON.stringify({ state: closing ? "paused" : "open" }) });
      // The page depends on the setting (the test panel), and a same-address navigation does not re-render: run the view again.
      await selfServiceSettings();
      toast(closing ? "Self-Service is closed for maintenance." : "Self-Service is open.");
    } catch (error) { setMessage(document.querySelector("#ss-alert")!, failure(error)); }
  });
}
