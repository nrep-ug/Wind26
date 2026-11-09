"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import jsQR from "jsqr"
import { api, formatDate, formatTime } from "@/components/api"
import { Columns } from "@/components/admin/Charts"

const SAME_CODE_COOLDOWN_MS = 4000
// A whole badge code: an optional event-code prefix such as "CODE:", then the tag's UUID.
const FULL_CODE = /(^|:|\/)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 880 : 220
    gain.gain.value = 0.08
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.35))
  } catch { /* sound is optional */ }
}

export default function ScannerApp({ local = false }) {
  const [summary, setSummary] = useState(null)
  const [result, setResult] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [online, setOnline] = useState(true)
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState([])
  const [chosen, setChosen] = useState(null)
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const lastCode = useRef({ code: "", at: 0 })
  const sending = useRef(false)
  const wedgeRef = useRef(null)
  const wedgeTimer = useRef(null)
  const [via, setVia] = useState("camera")
  const [lastRead, setLastRead] = useState("")

  const loadSummary = useCallback(() => api("/api/scan/summary").then(setSummary).catch((e) => setResult({ tone: "bad", title: e.message })), [])

  useEffect(() => {
    loadSummary()
    const timer = setInterval(loadSummary, 60_000)
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [loadSummary])

  const submit = useCallback(async (body) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      const r = await api("/api/scan/checkin", { method: "POST", body })
      const tz = summary?.event?.timezone
      if (r.status === "test") {
        setResult({ tone: "test", title: "Test scan: badge recognised. Nothing was recorded.", who: r.attendee.fullName, org: r.attendee.organization, note: r.message })
        beep(true)
      } else if (r.status === "accepted") {
        setResult({ tone: "ok", title: `Checked in · Day ${r.day}`, who: r.attendee.fullName, org: r.attendee.organization })
        beep(true)
      } else {
        setResult({ tone: "warn", title: `Already checked in today at ${formatTime(r.checkedInAt, tz)}`, who: r.attendee.fullName, org: r.attendee.organization })
        beep(false)
      }
      setChosen(null)
      setQuery("")
      loadSummary()
    } catch (error) {
      setResult({ tone: "bad", title: error.message })
      beep(false)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }, [loadSummary, summary])

  // The camera sees the same QR in many frames, so it waits before repeating a code.
  // A handheld scanner reads once per trigger pull, so every read counts.
  const onCode = useCallback((code, via = "camera") => {
    const now = Date.now()
    if (via === "camera" && code === lastCode.current.code && now - lastCode.current.at < SAME_CODE_COOLDOWN_MS) return
    lastCode.current = { code, at: now }
    setVia(via)
    submit({ code })
  }, [submit])

  // Some handheld scanners don't press Enter after the code. Send a complete code
  // on its own once the typing stops.
  const sendWedge = useCallback(() => {
    clearTimeout(wedgeTimer.current)
    const value = wedgeRef.current?.value.trim() || ""
    if (!value) return
    wedgeRef.current.value = ""
    setLastRead(value)
    onCode(value, "wedge")
  }, [onCode])
  const onWedgeInput = useCallback(() => {
    clearTimeout(wedgeTimer.current)
    if (FULL_CODE.test(wedgeRef.current?.value.trim() || "")) wedgeTimer.current = setTimeout(sendWedge, 150)
  }, [sendWedge])

  // Camera loop: decode a frame roughly 8 times a second.
  useEffect(() => {
    if (!cameraOn) return undefined
    let stopped = false
    let timer = null
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        const tick = () => {
          if (stopped) return
          const canvas = canvasRef.current
          if (video.readyState >= 2 && canvas) {
            const size = Math.min(video.videoWidth, video.videoHeight)
            const scale = Math.min(1, 640 / size)
            canvas.width = Math.round(size * scale)
            canvas.height = Math.round(size * scale)
            const ctx = canvas.getContext("2d", { willReadFrequently: true })
            ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, canvas.width, canvas.height)
            const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })
            if (found?.data) onCode(found.data)
          }
          timer = setTimeout(tick, 120)
        }
        tick()
      } catch (error) {
        setCameraError(error?.name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera for this site in the browser settings, or use search below."
          : "The camera couldn't start. Use search below, or a handheld scanner.")
        setCameraOn(false)
      }
    }
    start()
    return () => {
      stopped = true
      clearTimeout(timer)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [cameraOn, onCode])

  // Desk search, debounced.
  useEffect(() => {
    if (query.trim().length < 2) return undefined
    const timer = setTimeout(() => {
      api(`/api/scan/search?q=${encodeURIComponent(query.trim())}`).then((r) => setMatches(r.results)).catch(() => setMatches([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  async function signOut() {
    await api("/api/auth/sign-out", { method: "POST" }).catch(() => {})
    // Full reload on purpose: it clears all in-memory data after sign-out or an expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login"
  }

  const w = summary?.window
  const visibleMatches = query.trim().length >= 2 ? matches : []
  return (
    <main className="scanner stack">
      <div className="row spread">
        <div>
          <p className="brand" style={{ color: "var(--teal-700)" }}>{summary?.event?.shortName || summary?.event?.name || "Scanner"}</p>
          {w?.day && <p className="muted small">Day {w.day} · {formatDate(w.date)}</p>}
        </div>
        <div className="row">
          {summary && <span className="pill ok num" title="Checked in today">{summary.checkedInToday} / {summary.total}</span>}
          {local ? <a className="button secondary" href="/admin">Dashboard</a> : <button className="secondary" onClick={signOut}>Sign out</button>}
        </div>
      </div>

      {summary && <TodayStrip summary={summary} />}

      {!online && <p className="notice bad">No connection. Scans can&apos;t be saved right now. Write names on the paper list; an admin will add them later.</p>}
      {w && !w.ok && <p className="notice warn">{w.message}</p>}

      {result && via !== "wedge" && <ResultCard result={result} />}

      <div className="camera">
        <video ref={videoRef} playsInline muted hidden={!cameraOn} />
        {cameraOn && <div className="frame" />}
        {!cameraOn && (
          <div className="idle">
            <div className="stack" style={{ alignItems: "center" }}>
              <p>Point the camera at the QR code on the tag or the attendee&apos;s phone.</p>
              <button className="accent" onClick={() => { setCameraError(""); setCameraOn(true) }}>Start camera</button>
              {cameraError && <p className="small">{cameraError}</p>}
            </div>
          </div>
        )}
        <canvas ref={canvasRef} hidden />
      </div>
      {cameraOn && <button className="secondary" onClick={() => setCameraOn(false)}>Stop camera</button>}

      <form className="card stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); sendWedge() }}>
        <label htmlFor="wedge">Handheld scanner or pasted code
          <input id="wedge" ref={wedgeRef} autoComplete="off" placeholder="Click here, then scan" onInput={onWedgeInput} />
        </label>
        {busy && via === "wedge" && <p className="small muted">Checking…</p>}
        {lastRead && <p className="small muted" style={{ overflowWrap: "anywhere" }}>Last read: <span className="num">{lastRead}</span></p>}
        {result && via === "wedge" && <ResultCard result={result} />}
      </form>

      <div className="card stack">
        <h2>Can&apos;t scan? Find the attendee</h2>
        <label htmlFor="search">Name, organisation, email or phone
          <input id="search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setChosen(null) }} autoComplete="off" />
        </label>
        {visibleMatches.length > 0 && !chosen && (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
            {visibleMatches.map((m) => (
              <li key={m.id}>
                <button className="secondary" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => setChosen(m)}>
                  <span style={{ textAlign: "left" }}>{m.fullName}<br /><span className="muted small">{m.organization} {m.email}</span></span>
                  <span>Select</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && !visibleMatches.length && <p className="muted small">No one found. Check the spelling, or send them to the admin desk.</p>}
        {chosen && (
          <form className="stack" onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            setVia("desk")
            submit({ attendeeId: chosen.id, reason: f.get("reason"), note: f.get("note") })
          }}>
            <p><strong>{chosen.fullName}</strong> <span className="muted">{chosen.organization}</span></p>
            <label htmlFor="reason">Why isn&apos;t the tag being scanned?
              <select id="reason" name="reason" required defaultValue="">
                <option value="" disabled>Choose a reason</option>
                {(summary?.reasons || []).filter((r) => r.value !== "paper_list").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label htmlFor="note">Note (required for &ldquo;Other&rdquo;)<input id="note" name="note" maxLength={200} /></label>
            <div className="row">
              <button type="submit" disabled={busy}>Check in {chosen.fullName.split(" ")[0]}</button>
              <button type="button" className="secondary" onClick={() => setChosen(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
      {summary && <DeskStats summary={summary} />}
      {!local && <p className="muted small">Signed in as {summary?.operator?.name}. Hand checks are logged with your name.</p>}
    </main>
  )
}

const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

// Today's progress as a ring, with how people were checked in.
function TodayStrip({ summary }) {
  const { checkedInToday: done, total, today } = summary
  const share = total ? done / total : 0
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="card sc-strip">
      <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`${done} of ${total} checked in today`}>
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--brand)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 34 34)" />
        <text x="34" y="38" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">{Math.round(share * 100)}%</text>
      </svg>
      <div className="grow">
        <p><b className="num" style={{ fontSize: "1.4rem" }}>{done}</b> <span className="muted">of {total} checked in today</span></p>
        <p className="small muted">{total - done} still to come</p>
      </div>
      {today && (
        <dl className="sc-mini">
          <div><dt>QR</dt><dd className="num">{today.qr}</dd></div>
          <div><dt>By hand</dt><dd className="num">{today.manual}</dd></div>
          <div><dt>By you</dt><dd className="num">{today.mine}</dd></div>
        </dl>
      )}
    </div>
  )
}

// Arrivals per half hour, each day's total and the last few names.
function DeskStats({ summary }) {
  const { today, days = [], total, window: w } = summary
  const tz = summary.event?.timezone
  const busiest = today?.slots.reduce((best, s) => (s.count > (best?.count || 0) ? s : best), null)
  return (
    <section className="card stack">
      <div className="card-head">
        <h2>At the desk</h2>
        {busiest && <span className="small muted">Busiest: {clock(busiest.m)}–{clock(busiest.m + 29)}</span>}
      </div>
      {today?.slots.length ? (
        <Columns compact color="var(--brand)" max={Math.max(1, ...today.slots.map((s) => s.count))}
          items={today.slots.map((s) => ({
            key: s.m, value: s.count, label: clock(s.m),
            tip: [`${clock(s.m)}–${clock(s.m + 29)}`, `${s.count} checked in`], onClick: () => {},
          }))} />
      ) : <p className="muted small">{w?.ok ? "No one checked in yet today. Arrivals per half hour show here." : "Arrivals per half hour show here once check-in opens."}</p>}

      {days.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Each day</h3>
          {days.map((d) => (
            <div key={d.day} className={`sc-day ${d.day === w?.day ? "today" : ""}`}>
              <span className="small">Day {d.day} <span className="muted">{formatDate(d.date).replace(/ d{4}$/, "")}</span></span>
              <span className="an-hbar-track" style={{ width: "100%" }}><i style={{ width: `${total ? Math.round((d.count / total) * 100) : 0}%` }} /></span>
              <span className="small num">{d.count}/{total}</span>
            </div>
          ))}
        </div>
      )}

      {today?.recent.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Just checked in</h3>
          <ul className="sc-recent">
            {today.recent.map((p, i) => (
              <li key={i}>
                <span className="grow"><b>{p.name}</b> <span className="muted small">{p.organization}</span></span>
                <span className="small muted num">{formatTime(p.at, tz)}{p.source === "manual" ? " · by hand" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ResultCard({ result }) {
  return (
    <div className={`result ${result.tone}`} role="status" aria-live="assertive">
      <p style={{ fontWeight: 700 }}>{result.title}</p>
      {result.who && <p className="who">{result.who}</p>}
      {result.org && <p className="muted">{result.org}</p>}
      {result.note && <p className="small">{result.note}</p>}
    </div>
  )
}
