"use client"

import { useState } from "react"
import { api, formatDate } from "@/components/api"
import { localParts } from "@/lib/shared/event-days.mjs"
import Dialog, { Toast, plural, useAction } from "./Dialog"
import Icon from "./Icon"
import { emailCertificates, issueCertificates } from "./actions"

const closeMenu = (e) => { const d = e.currentTarget.closest("details"); if (d) d.open = false }
const FILTERS = { all: "Everyone", eligible: "Eligible", pending: "Eligible, not sent", not: "Not eligible" }

export default function CertificatesPanel({ event, attendees, reload }) {
  const base = `/api/admin/events/${event.id}`
  const { busy, message, setMessage, run } = useAction(reload)
  const [confirmAll, setConfirmAll] = useState(false)
  const [revoking, setRevoking] = useState(null)
  const [filter, setFilter] = useState("all")

  const eligible = attendees.filter((a) => a.eligibility.eligible)
  const toIssue = eligible.filter((a) => !a.certificate)
  const issued = attendees.filter((a) => a.certificate?.status === "issued")
  const toEmail = issued.filter((a) => a.email && !a.certificate.emailedAt)
  const pending = eligible.filter((a) => a.email && (!a.certificate || (a.certificate.status === "issued" && !a.certificate.emailedAt)))
  const canIssue = ["live", "closed"].includes(event.status)
  const lastDay = event.days[event.days.length - 1]
  const beforeLastDay = localParts(event.timezone).date < lastDay.date

  const rows = attendees.filter((a) => {
    if (filter === "eligible") return a.eligibility.eligible
    if (filter === "pending") return pending.includes(a)
    if (filter === "not") return !a.eligibility.eligible
    return true
  })

  // Issue to everyone eligible, then email every issued certificate that hasn't been sent.
  const sendAll = () => run(async (progress) => {
    const results = toIssue.length ? await issueCertificates(event.id, toIssue.map((a) => a.id), progress) : []
    const fresh = results.filter((r) => r.status === "issued" && r.certificateId).map((r) => r.certificateId)
    const withEmail = new Set(eligible.filter((a) => a.email).map((a) => a.id))
    const freshToEmail = results.filter((r) => r.status === "issued" && withEmail.has(r.attendeeId)).map((r) => r.certificateId)
    const ids = [...new Set([...toEmail.map((a) => a.certificate.id), ...freshToEmail])]
    const emailed = ids.length ? await emailCertificates(event.id, ids, { progress }) : { tone: "ok", sent: 0, failed: 0 }
    return { issued: fresh.length, ...emailed }
  }, (r) => ({ tone: r.failed ? "warn" : "ok", text: `Issued ${plural(r.issued, "certificate")} and emailed ${r.sent}.${r.failed ? ` ${r.failed} failed. Press Send again to retry them.` : ""}` }))

  const issueOne = (a) => run((p) => issueCertificates(event.id, [a.id], p), (r) => (r[0]?.status === "issued" ? `Issued to ${a.fullName}.` : { tone: "warn", text: "Not issued: already issued or not eligible." }))
  const emailOne = (a) => run((progress) => emailCertificates(event.id, [a.certificate.id], { resend: true, progress }), (r) => r)
  const act = (a, action, reason = "") => run(() => api(`${base}/certificates/${a.certificate.id}`, { method: "POST", body: { action, reason } }),
    { revoke: "Certificate revoked.", restore: "Certificate restored.", refresh_name: "Name updated." }[action])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Certificates</h1>
          <p>For attendees present at least {event.certificateMinDays} of {event.days.length} days</p>
        </div>
      </div>

      <section className="card stack">
        <div className="stats">
          <div className="stat"><b>{eligible.length}</b><span>Eligible</span></div>
          <div className="stat"><b>{issued.length}</b><span>Issued</span></div>
          <div className="stat"><b>{issued.filter((a) => a.certificate.emailedAt).length}</b><span>Emailed</span></div>
          <div className="stat"><b>{attendees.length - eligible.length}</b><span>Not eligible yet</span></div>
        </div>
        {!canIssue && <p className="notice warn">Open check-in first. Certificates can be issued while the event is live or closed.</p>}
        {canIssue && beforeLastDay && <p className="notice info">The last day is {formatDate(lastDay.date)}. Send after the final check-in so everyone who qualifies is included.</p>}
        <div className="row">
          <button className="accent big" disabled={busy || !canIssue || (!toIssue.length && !toEmail.length)} onClick={() => setConfirmAll(true)}>
            <Icon name="send" />Send certificates to all{pending.length ? ` (${pending.length})` : ""}
          </button>
          {issued.length > 0 && (
            <a className="button secondary big" href={`${base}/certificates/pdf`}><Icon name="download" />All {issued.length} in one PDF</a>
          )}
          {!toIssue.length && !toEmail.length && issued.length > 0 && <span className="pill ok">Everyone eligible has been sent theirs</span>}
        </div>
      </section>

      <div className="row spread">
        <div className="row" role="tablist" aria-label="Filter">
          {Object.entries(FILTERS).map(([k, label]) => (
            <button key={k} className={filter === k ? "" : "secondary"} aria-selected={filter === k} role="tab" onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Days</th><th>Certificate</th><th /></tr></thead>
          <tbody>
            {rows.map((a) => {
              const c = a.certificate
              const nameChanged = c && c.nameOnCertificate !== a.fullName
              return (
                <tr key={a.id}>
                  <td className="person"><b>{a.fullName}</b><span>{a.organization}</span></td>
                  <td className="num">
                    {a.eligibility.daysAttended}/{a.eligibility.totalDays}{" "}
                    {a.eligibility.eligible ? <span className="pill ok">Eligible</span> : <span className="pill neutral">Not yet</span>}
                  </td>
                  <td>
                    {!c && <span className="muted small">Not issued</span>}
                    {c?.status === "issued" && (c.emailedAt ? <span className="pill ok">Sent</span> : <span className="pill brand">Issued</span>)}
                    {c?.status === "revoked" && <span className="pill bad" title={c.revokedReason}>Revoked</span>}
                    {nameChanged && <div className="field-error">Shows &ldquo;{c.nameOnCertificate}&rdquo;</div>}
                  </td>
                  <td className="actions">
                    {(c || (a.eligibility.eligible && canIssue)) && (
                      <details className="menu">
                        <summary className="button ghost icon-btn" aria-label={`Actions for ${a.fullName}`}><Icon name="more" /></summary>
                        <div className="menu-list" onClick={closeMenu}>
                          {!c && <button disabled={busy} onClick={() => issueOne(a)}>Issue certificate</button>}
                          {c && <a href={`/verify/${c.id}`} target="_blank" rel="noreferrer">Open verification page</a>}
                          {c && <a href={`${base}/certificates/${c.id}/pdf`}>Download PDF</a>}
                          {c?.status === "issued" && a.email && <button disabled={busy} onClick={() => emailOne(a)}>{c.emailedAt ? "Resend" : "Email"}</button>}
                          {nameChanged && <button disabled={busy} onClick={() => act(a, "refresh_name")}>Use current name</button>}
                          {c?.status === "issued" && <button className="danger-item" onClick={() => setRevoking(a)}>Revoke</button>}
                          {c?.status === "revoked" && <button disabled={busy} onClick={() => act(a, "restore")}>Restore</button>}
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={4} className="empty">No one here.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog message={message} open={confirmAll} title="Send certificates to all?" onClose={() => setConfirmAll(false)}>
        <div className="stack">
          <p>
            {toIssue.length > 0 && <>{plural(toIssue.length, "certificate")} will be issued. </>}
            Every eligible attendee with an email who hasn&apos;t received theirs will be emailed.
          </p>
          {eligible.some((a) => !a.email) && <p className="muted small">{plural(eligible.filter((a) => !a.email).length, "eligible person", "eligible people")} without an email will get a certificate to download or print.</p>}
          <div className="dialog-foot">
            <button className="secondary" onClick={() => setConfirmAll(false)}>Cancel</button>
            <button className="accent" disabled={busy} onClick={() => { setConfirmAll(false); sendAll() }}><Icon name="send" />Send</button>
          </div>
        </div>
      </Dialog>

      <Dialog message={message} open={Boolean(revoking)} title="Revoke certificate?" onClose={() => setRevoking(null)}>
        {revoking && (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await act(revoking, "revoke", new FormData(e.currentTarget).get("reason"))) setRevoking(null) }}>
            <p>{revoking.fullName}&apos;s verification page will show it as revoked.</p>
            <label htmlFor="revoke-reason">Reason<input id="revoke-reason" name="reason" required minLength={3} maxLength={200} autoFocus /></label>
            <div className="dialog-foot">
              <button type="button" className="secondary" onClick={() => setRevoking(null)}>Cancel</button>
              <button className="danger solid" type="submit" disabled={busy}>Revoke</button>
            </div>
          </form>
        )}
      </Dialog>

      <Toast message={message} onClose={() => setMessage(null)} />
    </>
  )
}
