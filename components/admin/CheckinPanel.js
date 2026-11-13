"use client"

import { useCallback, useEffect, useState } from "react"
import { api, formatDate } from "@/components/api"
import { localParts } from "@/lib/shared/event-days.mjs"
import Dialog, { Toast, useAction } from "./Dialog"
import Icon from "./Icon"

// "typed" changes are hard to undo, so they ask for the event code.
const NEXT = {
  draft: [{ status: "live", label: "Open check-in", tone: "" }],
  live: [{ status: "closed", label: "Close event", tone: "secondary", typed: true }],
  closed: [{ status: "live", label: "Reopen check-in", tone: "secondary" }, { status: "archived", label: "Archive", tone: "danger", typed: true }],
  archived: [],
}
const STATUS_TEXT = {
  draft: "Check-in is not open yet.",
  live: "Check-in is open.",
  closed: "The event is closed. Certificates can still be issued.",
  archived: "Archived. Badge links no longer work; certificate links do.",
}

export default function CheckinPanel({ event, attendees, reload, local }) {
  const base = `/api/admin/events/${event.id}`
  const { busy, message, setMessage, run } = useAction(reload)
  const [change, setChange] = useState(null)
  const [scanners, setScanners] = useState([])
  const [codes, setCodes] = useState(false) // true when helpers sign in with a scanner code
  const today = localParts(event.timezone).date

  const loadScanners = useCallback(() => api(`${base}/scanners`).then((r) => { setScanners(r.scanners); setCodes(Boolean(r.codes)) }).catch(() => {}), [base])
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => setMessage({ tone: "ok", text: "Code copied." })).catch(() => {})
  useEffect(() => { if (!local) loadScanners() }, [local, loadScanners])

  async function changeStatus(e) {
    e.preventDefault()
    const code = change.typed ? new FormData(e.currentTarget).get("code") : event.code
    const ok = await run(() => api(base, { method: "PATCH", body: { status: change.status, confirmCode: code } }), `${change.label}: done.`)
    if (ok) setChange(null)
  }

  async function addScanner(e) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form))
    const ok = await run(() => api(`${base}/scanners`, { method: "POST", body: data }),
      codes ? `${data.name} is added. Give them their ${data.role === "admin" ? "admin" : "scanner"} code from the list.` : `${data.name} can now sign in and scan.`)
    if (ok) { form.reset(); loadScanners() }
  }

  const toggle = (s) => run(() => api(`${base}/scanners/${s.id}`, { method: "PATCH", body: { status: s.status === "active" ? "disabled" : "active" } }))
    .then(loadScanners)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Check-in</h1>
          <p>{event.checkinOpens}–{event.checkinCloses} each event day</p>
        </div>
        <a className={`button ${event.status === "live" ? "accent" : "secondary"}`} href="/scan"><Icon name="scan" />Open scanner</a>
      </div>

      <section className="card stack">
        <div className="card-head">
          <div>
            <h2>Status</h2>
            <p className="small">{STATUS_TEXT[event.status]}</p>
          </div>
          <div className="row">
            {NEXT[event.status].map((n) => <button key={n.status} className={n.tone} onClick={() => setChange(n)}>{n.label}</button>)}
          </div>
        </div>
        <div className="stats">
          {event.days.map((d) => {
            const n = attendees.filter((a) => a.days.includes(d.day)).length
            return (
              <div className="stat" key={d.day} style={d.date === today ? { borderColor: "var(--brand)" } : undefined}>
                <b>{n}</b>
                <span>Day {d.day} · {formatDate(d.date).replace(/ \d{4}$/, "")}{d.date === today ? " · today" : ""}</span>
                <div className="meter"><i style={{ width: `${attendees.length ? Math.round((n / attendees.length) * 100) : 0}%` }} /></div>
              </div>
            )
          })}
        </div>
        <p className="muted small">Scan with a phone or laptop camera, or a handheld scanner. If someone can&apos;t be scanned, record them from Attendees.</p>
      </section>

      {!local && (
        <section className="card stack">
          <div>
            <h2>{codes ? "Helpers and extra admins" : "Scanner helpers"}</h2>
            <p className="muted small">
              {codes
                ? "Each person signs in at the sign-in page with their own code, in place of the admin password. A scanner code opens only the scanner for this event; an admin code opens the full admin side. Disable someone to turn their code off at once."
                : "They can only check people in for this event."}
            </p>
          </div>
          {scanners.length > 0 && (
            <div className="table-wrap">
              <table>
                <tbody>
                  {scanners.map((s) => (
                    <tr key={s.id}>
                      <td className="person"><b>{s.name}</b><span>{s.email || "No email"}</span></td>
                      {codes && <td><span className={`pill ${s.role === "admin" ? "brand" : "neutral"}`}>{s.role === "admin" ? "Admin" : "Scanner"}</span></td>}
                      {s.code && (
                        <td>
                          <button type="button" className="ghost scanner-code" title="Copy code" disabled={s.status !== "active"} onClick={() => copy(s.code)}>
                            <code>{s.code}</code>
                          </button>
                        </td>
                      )}
                      <td><span className={`pill ${s.status === "active" ? "ok" : "neutral"}`}>{s.status}</span></td>
                      <td className="actions"><button className="secondary" disabled={busy} onClick={() => toggle(s)}>{s.status === "active" ? "Disable" : "Enable"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form className="row" onSubmit={addScanner} style={{ alignItems: "flex-end" }}>
            <label htmlFor="s-name" style={{ flex: "1 1 160px" }}>Name<input id="s-name" name="name" required /></label>
            <label htmlFor="s-email" style={{ flex: "2 1 220px" }}>{codes ? "Email (optional)" : "Email"}<input id="s-email" name="email" type="email" required={!codes} /></label>
            {codes && (
              <label htmlFor="s-role" style={{ flex: "0 1 170px" }}>Role
                <select id="s-role" name="role" defaultValue="scanner">
                  <option value="scanner">Scanner only</option>
                  <option value="admin">Admin (full access)</option>
                </select>
              </label>
            )}
            <button type="submit" disabled={busy}><Icon name="plus" />Add</button>
          </form>
        </section>
      )}

      <Dialog message={message} open={Boolean(change)} title={change ? `${change.label}?` : ""} onClose={() => setChange(null)}>
        {change && (
          <form className="stack" onSubmit={changeStatus}>
            {change.status === "live" && <p>Scanners can check people in during check-in hours on event days.</p>}
            {change.status === "closed" && <p>Scanning stops. You can reopen it later.</p>}
            {change.status === "archived" && <p>Badge links stop working. This can&apos;t be undone.</p>}
            {change.typed && (
              <label htmlFor="confirm-code">Type <strong>{event.code}</strong> to confirm<input id="confirm-code" name="code" autoComplete="off" required autoFocus /></label>
            )}
            <div className="dialog-foot">
              <button type="button" className="secondary" onClick={() => setChange(null)}>Cancel</button>
              <button type="submit" className={change.status === "archived" ? "danger solid" : ""} disabled={busy}>{change.label}</button>
            </div>
          </form>
        )}
      </Dialog>

      <Toast message={message} onClose={() => setMessage(null)} />
    </>
  )
}
