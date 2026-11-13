"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { api, formatTime } from "@/components/api"
import { localParts } from "@/lib/shared/event-days.mjs"
import { QUIZ_KINDS } from "@/lib/shared/quiz.mjs"
import { groupOrganisations } from "@/lib/shared/org.mjs"
import { GENDERS } from "@/lib/shared/validation.mjs"
import Icon from "./Icon"
import { Columns, useTip } from "./Charts"
import { plural } from "./Dialog"

// Two series (pre and post quiz) checked for colour-blind separation and contrast on white.
const SERIES = ["#00809a", "#bf6800"]
const BUCKET_MIN = 30
const SCORE_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((lo) => ({ lo, hi: lo === 90 ? 100 : lo + 9 }))
const shortDay = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)

export default function AnalyticsPanel({ event, attendees, quizzes }) {
  const [org, setOrg] = useState("")
  const [gender, setGender] = useState("") // "", "female", "male" or "none"
  const [segment, setSegment] = useState(null) // { id, label, test(attendee) }
  const [day, setDay] = useState(null)
  const [allOrgs, setAllOrgs] = useState(false)
  const [results, setResults] = useState({}) // quizId -> Map(attendeeId -> percent)
  const [view, setView] = useState({ day: null, came: true, count: null }) // the "Who came" list
  const whoRef = useRef(null)
  const showWho = (next) => { setView(next); whoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }

  // Scores per person, for the distribution chart and the people table.
  useEffect(() => {
    let cancelled = false
    const answered = quizzes.filter((q) => q.responses > 0)
    Promise.all(answered.map((q) => api(`/api/admin/events/${event.id}/quizzes/${q.id}`).then((r) => [q.id, new Map(r.responses.map((x) => [x.attendeeId, x.percent]))])))
      .then((pairs) => { if (!cancelled) setResults(Object.fromEntries(pairs)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [event.id, quizzes])

  const orgOf = useMemo(() => groupOrganisations(attendees.map((a) => a.organization)), [attendees])
  const groups = useMemo(() => {
    const map = new Map()
    for (const a of attendees) {
      const { key, label } = orgOf.get(a.organization.trim())
      if (!map.has(key)) map.set(key, { key, label, names: new Set(), people: [] })
      map.get(key).people.push(a)
      map.get(key).names.add(a.organization)
    }
    return [...map.values()]
      .map((g) => ({ ...g, title: [...g.names].join(" · "), came: g.people.filter((a) => a.days.length).length }))
      .sort((x, y) => y.people.length - x.people.length || x.label.localeCompare(y.label))
  }, [attendees, orgOf])

  const inOrg = org ? attendees.filter((a) => orgOf.get(a.organization.trim()).key === org) : attendees
  const genderOf = (a) => a.gender || "none"
  const scoped = gender ? inOrg.filter((a) => genderOf(a) === gender) : inOrg
  const people = segment ? scoped.filter(segment.test) : scoped
  const orgLabel = groups.find((g) => g.key === org)?.label
  const GENDER_GROUPS = { ...GENDERS, none: "Not recorded" }
  const genderLabel = gender ? GENDER_GROUPS[gender] : ""

  const pick = (next) => setSegment((cur) => (cur?.id === next.id ? null : next))
  const withEmail = scoped.filter((a) => a.email)
  const badgesSent = withEmail.filter((a) => a.tagEmailedAt).length
  const came = scoped.filter((a) => a.days.length).length
  const eligible = scoped.filter((a) => a.eligibility.eligible).length
  const pre = quizzes.find((q) => q.kind === "pre")
  const preTook = pre && results[pre.id] ? scoped.filter((a) => results[pre.id].has(a.id)).length : 0

  // Day columns and the arrival times of the chosen day.
  const dayStats = event.days.map((d) => ({ ...d, came: scoped.filter((a) => a.days.includes(d.day)).length }))
  const shownDay = day ?? ([...dayStats].reverse().find((d) => d.came)?.day || event.days[0]?.day)
  const times = scoped.flatMap((a) => a.checkins.filter((c) => c.day === shownDay && c.at).map((c) => ({ id: a.id, m: localParts(event.timezone, new Date(c.at)).minutes })))
  const arrivals = []
  if (times.length) {
    const first = Math.floor(Math.min(...times.map((t) => t.m)) / BUCKET_MIN) * BUCKET_MIN
    const last = Math.floor(Math.max(...times.map((t) => t.m)) / BUCKET_MIN) * BUCKET_MIN
    for (let m = first; m <= last; m += BUCKET_MIN) arrivals.push({ m, ids: new Set(times.filter((t) => t.m >= m && t.m < m + BUCKET_MIN).map((t) => t.id)) })
  }

  const answeredQuizzes = quizzes.filter((q) => results[q.id])
  const scoreSeries = answeredQuizzes.slice(0, 2).map((q, i) => {
    const scores = scoped.map((a) => results[q.id].get(a.id)).filter((s) => s !== undefined)
    return { q, color: SERIES[i], counts: SCORE_BUCKETS.map((b) => scores.filter((s) => s >= b.lo && s <= b.hi).length), n: scores.length, avg: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null }
  })
  const scoreMax = Math.max(1, ...scoreSeries.flatMap((s) => s.counts))
  // The average mark of every answered quiz, for whoever the filters leave in.
  const quizName = (q) => (q.kind === "other" ? q.title : QUIZ_KINDS[q.kind])
  const averages = answeredQuizzes.map((q) => {
    const scores = scoped.map((a) => results[q.id].get(a.id)).filter((s) => s !== undefined)
    const avg = scores.length ? Math.round(scores.reduce((t, x) => t + x, 0) / scores.length) : null
    return { q, n: scores.length, avg, passed: scores.filter((s) => s >= q.passMark).length }
  })
  // One person's average over the quizzes they took; null when they took none.
  const personAvg = (a) => {
    const s = answeredQuizzes.filter((q) => results[q.id].has(a.id)).map((q) => results[q.id].get(a.id))
    return s.length ? Math.round(s.reduce((t, x) => t + x, 0) / s.length) : null
  }
  const avgOf = (q, list) => {
    const scores = list.map((a) => results[q.id].get(a.id)).filter((s) => s !== undefined)
    return scores.length ? `${Math.round(scores.reduce((t, x) => t + x, 0) / scores.length)}%` : "—"
  }

  // The browser's print dialog saves the page as it is now, filters and all, as a PDF.
  // The file name follows the page title, so it says what was selected.
  function printPdf() {
    const title = document.title
    const parts = [orgLabel, genderLabel, segment?.label].filter(Boolean).map((s) => s.replace(/[^\w\s-]/g, "").trim())
    document.title = [`${event.code} analytics`, ...parts].join(" - ")
    window.addEventListener("afterprint", () => { document.title = title }, { once: true })
    window.print()
  }

  function downloadCsv() {
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const head = ["Name", "Organisation", "Gender", "Email", "Phone", "Days attended", "Badge emailed", ...answeredQuizzes.map((q) => `${q.title} (%)`), "Average (%)"]
    const rows = people.map((a) => [a.fullName, a.organization, GENDERS[a.gender] || "", a.email, a.phone, a.days.join(" "), a.tagEmailedAt ? "Yes" : a.email ? "No" : "No email",
      ...answeredQuizzes.map((q) => results[q.id].get(a.id) ?? ""), personAvg(a) ?? ""])
    const blob = new Blob([[head, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `${event.code}-people.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="no-print">Click any bar or number to see who is behind it.</p>
          <p className="print-only" suppressHydrationWarning>
            {event.name} · {[orgLabel, genderLabel, segment?.label].filter(Boolean).join(" · ") || "Everyone"} · printed {new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone })}
          </p>
        </div>
        <div className="row no-print">
          <button type="button" className="secondary" style={{ alignSelf: "flex-end" }} onClick={printPdf}><Icon name="download" />Download PDF</button>
        <label className="an-filter" htmlFor="an-gender">Gender
          <select id="an-gender" value={gender} onChange={(e) => { setGender(e.target.value); setSegment(null) }}>
            <option value="">Everyone ({inOrg.length})</option>
            {Object.entries(GENDER_GROUPS).map(([v, label]) => {
              const n = inOrg.filter((a) => genderOf(a) === v).length
              return (n || v !== "none") && <option key={v} value={v}>{label} ({n})</option>
            })}
          </select>
        </label>
        <label className="an-filter" htmlFor="an-org">Organisation
          <select id="an-org" value={org} onChange={(e) => { setOrg(e.target.value); setSegment(null) }}>
            <option value="">All organisations ({attendees.length})</option>
            {groups.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.people.length})</option>)}
          </select>
        </label>
        </div>
      </div>

      <div className="stats">
        <Kpi value={scoped.length} label="Registered" active={!segment} onClick={() => setSegment(null)} />
        <Kpi value={badgesSent} of={withEmail.length} label="Badges emailed" hint="Show who hasn't had one"
          active={segment?.id === "nobadge"} onClick={() => pick({ id: "nobadge", label: "Badge not emailed yet", test: (a) => !a.tagEmailedAt })} />
        <Kpi value={came} of={scoped.length} label="Came at least one day" hint="Show who never came"
          active={segment?.id === "never"} onClick={() => pick({ id: "never", label: "Not checked in on any day", test: (a) => !a.days.length })} />
        <Kpi value={eligible} of={scoped.length} label="Eligible for certificate"
          active={segment?.id === "eligible"} onClick={() => pick({ id: "eligible", label: "Eligible for a certificate", test: (a) => a.eligibility.eligible })} />
        {pre && <Kpi value={preTook} of={scoped.length} label="Took the pre-training quiz" hint="Show who hasn't"
          active={segment?.id === "nopre"} onClick={() => pick({ id: "nopre", label: `Haven't taken ${pre.title}`, test: (a) => !results[pre.id]?.has(a.id) })} />}
      </div>

      <div className="grid-2">
        <section className="card stack">
          <div className="card-head"><h2>Attendance by day</h2><span className="small muted">of {plural(scoped.length, "person", "people")}</span></div>
          <Columns
            items={dayStats.map((d) => ({
              key: d.day, value: d.came, label: `Day ${d.day}`, sub: shortDay(d.date), text: `${d.came}`,
              tip: [`Day ${d.day} · ${shortDay(d.date)}`, `${d.came} of ${scoped.length} checked in (${pct(d.came, scoped.length)}%)`, "Click to see who came"],
              active: view.day === d.day && view.came,
              onClick: () => { setDay(d.day); showWho({ day: d.day, came: true, count: null }) },
            }))}
            max={Math.max(1, scoped.length)} color="var(--brand)" />
          <div className="row small">
            {dayStats.map((d) => (
              <button key={d.day} type="button" className={`an-chip ${view.day === d.day && !view.came ? "on" : ""}`}
                onClick={() => showWho({ day: d.day, came: false, count: null })}>
                {scoped.length - d.came} missed day {d.day}
              </button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="card-head">
            <h2>Arrival times</h2>
            <div className="an-tabs" role="tablist" aria-label="Day">
              {event.days.map((d) => (
                <button key={d.day} type="button" role="tab" aria-selected={shownDay === d.day} onClick={() => setDay(d.day)}>Day {d.day}</button>
              ))}
            </div>
          </div>
          {arrivals.length ? (
            <Columns compact
              items={arrivals.map((b) => ({
                key: b.m, value: b.ids.size, label: clock(b.m), text: b.ids.size || "",
                tip: [`${clock(b.m)}–${clock(b.m + BUCKET_MIN - 1)}`, `${plural(b.ids.size, "person", "people")} checked in`],
                active: segment?.id === `arr${shownDay}-${b.m}`,
                onClick: () => pick({ id: `arr${shownDay}-${b.m}`, label: `Arrived ${clock(b.m)}–${clock(b.m + BUCKET_MIN - 1)} on day ${shownDay}`, test: (a) => b.ids.has(a.id) }),
              }))}
              max={Math.max(1, ...arrivals.map((b) => b.ids.size))} color="var(--brand)" />
          ) : <p className="muted small an-empty">No check-ins on day {shownDay} yet.</p>}
        </section>
      </div>

      <WhoCame refEl={whoRef} event={event} people={scoped} view={view} setView={setView} />

      <GenderCard event={event} people={inOrg} genderOf={genderOf} labels={GENDER_GROUPS} quizzes={answeredQuizzes} results={results}
        selected={gender} onPick={(g) => { setGender(gender === g ? "" : g); setSegment(null) }} />

      <section className="card stack">
        <div className="card-head">
          <h2>Organisations</h2>
          <span className="row small muted">
            <span className="an-key"><i style={{ background: "var(--brand)" }} />came at least one day</span>
            <span className="an-key"><i className="track" />registered</span>
          </span>
        </div>
        <div className="an-hbars">
          {(allOrgs ? groups : groups.slice(0, 10)).map((g) => (
            <button key={g.key} type="button" className={`an-hbar ${org === g.key ? "on" : ""}`} title={g.title}
              onClick={() => { setOrg(org === g.key ? "" : g.key); setSegment(null) }}>
              <span className="an-hbar-label">{g.label}</span>
              <span className="an-hbar-track" style={{ width: `${pct(g.people.length, groups[0].people.length)}%` }}>
                <i style={{ width: `${pct(g.came, g.people.length)}%` }} />
              </span>
              <span className="an-hbar-num num">{g.came ? `${g.came} of ${g.people.length}` : g.people.length}</span>
            </button>
          ))}
        </div>
        {groups.length > 10 && (
          <button type="button" className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAllOrgs(!allOrgs)}>
            {allOrgs ? "Show the top 10" : `Show all ${groups.length} organisations`}
          </button>
        )}
      </section>

      {scoreSeries.length > 0 && (
        <section className="card stack">
          <div className="card-head">
            <h2>Quiz scores</h2>
            <span className="row small muted">
              {scoreSeries.map((s) => (
                <span key={s.q.id} className="an-key"><i style={{ background: s.color }} />{quizName(s.q)}: {s.n} answered · average {s.avg ?? "—"}%</span>
              ))}
            </span>
          </div>
          <div className="stats">
            {averages.map((a) => (
              <div key={a.q.id} className="stat">
                <b>{a.avg ?? "—"}{a.avg !== null && "%"}</b>
                <span>Average · {quizName(a.q)}</span>
                <span className="muted small">{plural(a.n, "person", "people")} · {a.passed} passed ({a.q.passMark}%+)</span>
              </div>
            ))}
          </div>
          <ScoreChart series={scoreSeries} max={scoreMax} segment={segment}
            onPick={(s, b) => pick({ id: `score${s.q.id}-${b.lo}`, label: `${s.q.title}: scored ${b.lo}–${b.hi}%`, test: (a) => { const v = results[s.q.id].get(a.id); return v >= b.lo && v <= b.hi } })} />
          {scoreSeries[1]?.q.comparison?.both > 0 && (
            <p className="small">
              <strong>Before and after:</strong> {scoreSeries[1].q.comparison.preAverage}% → {scoreSeries[1].q.comparison.postAverage}% for the {plural(scoreSeries[1].q.comparison.both, "person", "people")} who took both · {scoreSeries[1].q.comparison.improved} improved
            </p>
          )}
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <div className="row spread">
          <div className="row">
            <h2>{plural(people.length, "person", "people")}</h2>
            {orgLabel && <button type="button" className="an-chip on" onClick={() => setOrg("")}>{orgLabel}<Icon name="x" size={14} /></button>}
            {genderLabel && <button type="button" className="an-chip on" onClick={() => setGender("")}>{genderLabel}<Icon name="x" size={14} /></button>}
            {segment && <button type="button" className="an-chip on" onClick={() => setSegment(null)}>{segment.label}<Icon name="x" size={14} /></button>}
          </div>
          <button type="button" className="secondary" onClick={downloadCsv} disabled={!people.length}><Icon name="download" />CSV of this list</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Days</th>
                <th>Badge</th>
                {answeredQuizzes.map((q) => <th key={q.id} className="num">{quizName(q)}</th>)}
                {answeredQuizzes.length > 0 && <th className="num" title="Average of the quizzes this person took">Average</th>}
              </tr>
            </thead>
            <tbody>
              {people.map((a) => (
                <tr key={a.id}>
                  <td className="person"><b>{a.fullName}</b><span>{a.organization}</span></td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      {event.days.map((d) => <span key={d.day} className={`an-day ${a.days.includes(d.day) ? "on" : ""}`} title={`Day ${d.day}: ${a.days.includes(d.day) ? "came" : "not checked in"}`}>{d.day}</span>)}
                    </span>
                  </td>
                  <td>{a.tagEmailedAt ? <span className="pill ok">Emailed</span> : a.email ? <span className="pill warn">Not sent</span> : <span className="pill neutral">No email</span>}</td>
                  {answeredQuizzes.map((q) => <td key={q.id} className="num">{results[q.id].has(a.id) ? `${results[q.id].get(a.id)}%` : <span className="muted">—</span>}</td>)}
                  {answeredQuizzes.length > 0 && <td className="num">{personAvg(a) === null ? <span className="muted">—</span> : <b>{personAvg(a)}%</b>}</td>}
                </tr>
              ))}
              {!people.length && <tr><td colSpan={4 + answeredQuizzes.length} className="muted">Nobody matches.</td></tr>}
            </tbody>
            {people.length > 0 && answeredQuizzes.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}><b>Average</b> <span className="muted small">of the people listed who took each quiz</span></td>
                  {answeredQuizzes.map((q) => <td key={q.id} className="num"><b>{avgOf(q, people)}</b></td>)}
                  <td className="num"><b>{(() => { const v = people.map(personAvg).filter((x) => x !== null); return v.length ? `${Math.round(v.reduce((t, x) => t + x, 0) / v.length)}%` : "—" })()}</b></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </>
  )
}

// Who came: pick a day (came or didn't), or how many days people attended, and see them as cards.
// Follows the gender and organisation filters. Tapping a bar in "Attendance by day" opens a day here.
function WhoCame({ refEl, event, people, view, setView }) {
  const total = event.days.length
  const countOf = (n) => people.filter((a) => a.days.length === n).length
  const COUNTS = [
    { n: total, label: total > 1 ? `All ${total} days` : "Came" },
    ...Array.from({ length: total - 1 }, (_, i) => total - 1 - i).map((n) => ({ n, label: n === 1 ? "Only 1 day" : `${n} days` })),
    { n: 0, label: "No days" },
  ]
  // Until a day is picked, show the latest day anyone came.
  const latest = [...event.days].reverse().find((d) => people.some((a) => a.days.includes(d.day)))?.day ?? event.days[0]?.day
  const day = view.count === null ? (view.day ?? latest) : null
  const list = (view.count !== null
    ? people.filter((a) => a.days.length === view.count)
    : people.filter((a) => a.days.includes(day) === view.came))
    .slice().sort((x, y) => x.fullName.localeCompare(y.fullName))
  const arrival = (a) => a.checkins.find((c) => c.day === day && c.at)?.at
  const title = view.count !== null
    ? (COUNTS.find((c) => c.n === view.count)?.label || "")
    : `${view.came ? "Came on" : "Didn't come on"} day ${day}`

  return (
    <section className="card stack" ref={refEl} style={{ scrollMarginTop: 80 }}>
      <div className="card-head">
        <h2>Who came</h2>
        <span className="small muted">of {plural(people.length, "registered person", "registered people")}</span>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row small">
          <span className="muted who-label">By day</span>
          {event.days.map((d) => {
            const n = people.filter((a) => a.days.includes(d.day)).length
            return (
              <button key={d.day} type="button" className={`an-chip ${view.count === null && day === d.day ? "on" : ""}`}
                onClick={() => setView({ day: d.day, came: view.count === null ? view.came : true, count: null })}>
                Day {d.day} · {view.count === null && !view.came ? `${people.length - n} missed` : `${n} came`}
              </button>
            )
          })}
          {view.count === null && (
            <span className="an-tabs" role="tablist" aria-label="Came or not">
              <button type="button" role="tab" aria-selected={view.came} onClick={() => setView({ ...view, came: true })}>Came</button>
              <button type="button" role="tab" aria-selected={!view.came} onClick={() => setView({ ...view, came: false })}>Didn&apos;t come</button>
            </span>
          )}
        </div>
        <div className="row small">
          <span className="muted who-label">Days attended</span>
          {COUNTS.map((c) => (
            <button key={c.n} type="button" className={`an-chip ${view.count === c.n ? "on" : ""}`}
              onClick={() => setView({ day: view.day, came: true, count: c.n })}>
              {c.label} · {countOf(c.n)}
            </button>
          ))}
        </div>
      </div>

      <p className="small"><b>{title}</b> · {plural(list.length, "person", "people")}</p>
      {list.length ? (
        <div className="who-grid">
          {list.map((a) => {
            const at = view.count === null && view.came ? arrival(a) : null
            return (
              <div key={a.id} className="who-card">
                <b>{a.fullName}</b>
                <span className="muted small">{a.organization || "—"}</span>
                <span className="row small" style={{ gap: 4, flexWrap: "nowrap" }}>
                  {event.days.map((d) => <span key={d.day} className={`an-day ${a.days.includes(d.day) ? "on" : ""}`} title={`Day ${d.day}: ${a.days.includes(d.day) ? "came" : "not checked in"}`}>{d.day}</span>)}
                  {at && <span className="muted num" style={{ marginLeft: 6 }}>arrived {formatTime(at, event.timezone)}</span>}
                </span>
                {(a.phone || a.email) && <span className="muted small who-contact">{a.phone || a.email}</span>}
              </div>
            )
          })}
        </div>
      ) : <p className="muted small">Nobody here.</p>}
    </section>
  )
}

// Women and men side by side: how many registered, came each day, and their quiz averages.
// Follows the organisation filter, and clicking a row filters the whole page to that group.
function GenderCard({ event, people, genderOf, labels, quizzes, results, selected, onPick }) {
  const rows = Object.entries(labels)
    .map(([key, label]) => ({ key, label, group: people.filter((a) => genderOf(a) === key) }))
    .filter((r) => r.group.length || r.key !== "none")
  if (!rows.some((r) => r.key !== "none" && r.group.length)) {
    return (
      <section className="card stack">
        <h2>Women and men</h2>
        <p className="muted small">No gender recorded yet. Set it when editing an attendee, or import a CSV with a Gender column.</p>
      </section>
    )
  }
  const average = (q, group) => {
    const scores = group.map((a) => results[q.id].get(a.id)).filter((v) => v !== undefined)
    return scores.length ? { avg: Math.round(scores.reduce((t, v) => t + v, 0) / scores.length), n: scores.length } : null
  }
  return (
    <section className="card stack">
      <div className="card-head"><h2>Women and men</h2><span className="small muted">Click a row to filter the page</span></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="num">Registered</th>
              {event.days.map((d) => <th key={d.day} className="num">Day {d.day}</th>)}
              {quizzes.map((q) => <th key={q.id} className="num">{q.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, group }) => (
              <tr key={key} className={selected === key ? "on" : ""} style={{ cursor: "pointer" }} onClick={() => onPick(key)}>
                <td><b>{label}</b></td>
                <td className="num">{group.length}</td>
                {event.days.map((d) => {
                  const came = group.filter((a) => a.days.includes(d.day)).length
                  return <td key={d.day} className="num">{came} <span className="muted small">({pct(came, group.length)}%)</span></td>
                })}
                {quizzes.map((q) => {
                  const r = average(q, group)
                  return <td key={q.id} className="num">{r ? <>{r.avg}% <span className="muted small">avg, {r.n} took it</span></> : <span className="muted">—</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Kpi({ value, of = 0, label, hint, active, onClick }) {
  return (
    <button type="button" className={`stat an-kpi ${active ? "on" : ""}`} onClick={onClick} aria-pressed={active} title={hint}>
      <b>{value}{of > 0 && <small> / {of}</small>}</b>
      <span>{label}</span>
      {of > 0 && <div className="meter"><i style={{ width: `${pct(value, of)}%` }} /></div>}
    </button>
  )
}

function ScoreChart({ series, max, segment, onPick }) {
  const { box, show, hide, el } = useTip()
  return (
    <div className="an-chart" ref={box} onMouseLeave={hide}>
      <div className="an-cols compact">
        {SCORE_BUCKETS.map((b, i) => (
          <div key={b.lo} className="an-col">
            <span className="an-col-plot an-group">
              {series.map((s) => {
                const tip = [`${s.q.title}`, `${plural(s.counts[i], "person", "people")} scored ${b.lo}–${b.hi}%`, "Click to see who"]
                return (
                  <button key={s.q.id} type="button" className={`an-mark ${segment?.id === `score${s.q.id}-${b.lo}` ? "on" : ""}`} aria-label={tip.join(". ")}
                    onMouseEnter={(e) => show(e, tip)} onFocus={(e) => show(e, tip)} onBlur={hide} onClick={() => onPick(s, b)}>
                    <i style={{ height: `${Math.max(s.counts[i] ? 2 : 0, pct(s.counts[i], max))}%`, background: s.color }} />
                  </button>
                )
              })}
            </span>
            <span className="an-col-label">{b.lo}%</span>
          </div>
        ))}
      </div>
      {el}
    </div>
  )
}
