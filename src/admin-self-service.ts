import "./admin.css";
import { adminPage, changeButton, confirmImpact, decisions, settingRows, settingsGroup, settle, stateTag, verdict } from "./admin-frame";
import { SELF_SERVICE_COPY as COPY, SELF_SERVICE_RULES } from "./setting-copy";
import { api, html, plural, stillShown, toast } from "./ui";

/** Administration > Self-Service: the one switch phones obey, what it changes, and what phones ask for (V1.16.7: in the four bands). */
export async function selfServiceSettings(): Promise<void> {
  const onPage = stillShown();
  const session = await adminPage("self-service", {
    title: "Self-Service",
    lede: "Whether people can use their own phones, and what phones ask for.",
    body: (session) => {
      const closed = session.selfServiceClosed;
      return html`
    ${closed ? verdict("warn", "Self-Service is closed for maintenance.", COPY.closed.effect) : verdict("ok", "Self-Service is open.", COPY.open.effect)}
    ${decisions(closed ? [{ what: "Self-Service is closed for maintenance.", detail: "Reopen it when the maintenance is done; phones then send what they kept meanwhile.", action: html`<button type="button" class="button button--primary button--sm" data-ss-toggle>Reopen</button>` }] : [])}
    ${settingsGroup("ss-switch-title", COPY.label, settingRows([{
      key: "self-service", name: "Self-Service on phones",
      value: closed ? stateTag("warn", COPY.closed.state) : stateTag("ok", COPY.open.state, true),
      does: closed ? COPY.closed.effect : COPY.open.effect,
      action: changeButton("Self-Service on phones", html`id="ss-toggle" data-ss-toggle`)
    }]), COPY.source)}
    ${settingsGroup("ss-rules-title", "What phones ask for", html`<p>These rules are the same on every phone and cannot be switched off here.</p>
      <dl class="guide">${SELF_SERVICE_RULES.map((rule) => html`<div><dt>${rule.action}</dt><dd>${rule.asks}</dd></div>`)}</dl>`)}
    ${closed ? html`<section class="admin-block settings-group ss-trial" aria-labelledby="ss-trial-title">
      <div class="admin-block__head"><h2 id="ss-trial-title" class="section-title">Test Self-Service</h2></div>
      <p>Self-Service is closed for maintenance, and everyone else sees the maintenance page. Here it works as it would on a phone, but every record you make is held in <a href="/staff/self-service" data-route>Self-Service</a> as a test and changes nothing unless someone applies it. Dismiss your tests there when you are done.</p>
      <iframe class="ss-trial__frame" src="/self-service" title="Self-Service in test mode" loading="lazy"></iframe>
    </section>` : ""}`;
    }
  });
  if (!session) return;
  document.querySelector(".admin-bands")!.addEventListener("click", async (event) => {
    if (!(event.target as HTMLElement).closest("[data-ss-toggle]")) return;
    const closing = !session.selfServiceClosed;
    const waiting = session.selfServiceReviews;
    const changed = await confirmImpact({
      kicker: COPY.label,
      title: closing ? "Close Self-Service for maintenance?" : "Reopen Self-Service?",
      now: closing ? COPY.open.state : COPY.closed.state,
      after: closing ? COPY.closed.state : COPY.open.state,
      impact: closing
        ? html`<p>Phones show the maintenance screen at once and record nothing until you reopen it. People are sent to DoL staff in person.</p>
          <p>${waiting ? `${plural(waiting, "record")} already waiting for a check stay in Self-Service.` : "Nothing is waiting for a check."} Records waiting on a phone are kept and sent when it reopens.</p>`
        : html`<p>Phones can take, borrow, use and return again at once. Records kept on phones during the closure are sent and wait for staff to check them.</p>`,
      affects: closing
        ? ["Everyone using Self-Service on their phone", "DoL staff, who serve people in person meanwhile"]
        : ["Everyone using Self-Service on their phone", "DoL staff, who check the records phones kept meanwhile"],
      undo: closing ? "You can reopen it here at any time." : "You can close it again here at any time.",
      confirm: closing ? "Close for maintenance" : "Reopen Self-Service",
      danger: closing,
      run: () => api("/api/staff/admin/self-service", { method: "PATCH", body: JSON.stringify({ state: closing ? "paused" : "open" }) }).then(() => undefined)
    });
    if (!changed) return;
    const done = closing ? "Self-Service is closed for maintenance." : "Self-Service is open.";
    // Left meanwhile: the change stands, and this page is not drawn over the one now shown.
    if (!onPage()) { toast(done); return; }
    // The page depends on the setting (the test panel), and a same-address navigation does not re-render: run the view again.
    await selfServiceSettings();
    settle("self-service");
    toast(done);
  });
}
