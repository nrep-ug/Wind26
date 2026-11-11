"use client"

import { useMemo, useState } from "react"
import { api, formatDate, formatTime } from "@/components/api"
import { QUIZ_KINDS, optionLetter, parseQuestions, questionsToText, quizOpenFrom, validateQuizInput } from "@/lib/shared/quiz.mjs"
import Dialog, { Toast, plural, useAction } from "./Dialog"
import Icon from "./Icon"

const STATUS = { draft: ["neutral", "Draft"], open: ["ok", "Open"], closed: ["warn", "Closed"] }
const SAMPLE = "1. Which component converts rotation into electricity?\nA. Rotor blade\nB. Generator\nC. Tower\nAnswer: B"

export default function QuizPanel({ event, quizzes, reload }) {
  const base = `/api/admin/events/${event.id}/quizzes`
  const { busy, message, setMessage, run } = useAction(reload)
  const [editor, setEditor] = useState(null) // { id?, title, kind, passMark, text }
  const [results, setResults] = useState(null)
  const [showNames, setShowNames] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const firstDay = quizOpenFrom(event)
  const lastDay = quizOpenFrom(event, undefined, "post")
  const taken = (kind, exceptId) => quizzes.some((q) => q.kind === kind && q.id !== exceptId)
  const hasPre = taken("pre")
  const hasPost = taken("post")
  const newKind = !hasPre ? "pre" : !hasPost ? "post" : "other"
  const NEW_TITLE = { pre: "Pre-training quiz", post: "Post-training quiz", other: "" }

  const parsed = useMemo(() => {
    if (!editor) return null
    const questions = parseQuestions(editor.text)
    return { questions, check: validateQuizInput({ title: editor.title, kind: editor.kind, passMark: Number(editor.passMark), questions }) }
  }, [editor])

  async function save(e) {
    e.preventDefault()
    const body = { title: editor.title, kind: editor.kind, passMark: Number(editor.passMark), questions: parsed.questions }
    const ok = await run(() => api(editor.id ? `${base}/${editor.id}` : base, { method: editor.id ? "PUT" : "POST", body }),
      editor.id ? "Quiz saved." : "Quiz created. Open it when attendees should answer.")
    if (ok) setEditor(null)
  }

  async function edit(q) {
    const r = await run(() => api(`${base}/${q.id}`))
    if (r) setEditor({ id: q.id, title: q.title, kind: q.kind, passMark: q.passMark, text: questionsToText(r.quiz.questions) })
  }

  // The usual set-up: the same questions before and after, so the scores can be compared.
  async function copyAsPost(q) {
    const r = await run(() => api(`${base}/${q.id}`))
    if (r) setEditor({ title: NEW_TITLE.post, kind: "post", passMark: q.passMark, text: questionsToText(r.quiz.questions) })
  }

  async function showResults(q) {
    const r = await run(() => api(`${base}/${q.id}`))
    if (r) setResults(r)
  }

  const setStatus = (q, status) => run(() => api(`${base}/${q.id}`, { method: "PATCH", body: { status } }),
    status === "open"
      ? `${q.title} is open. Attendees find it on their badge and quiz link.${q.kind === "post" && quizzes.some((x) => x.kind === "pre" && x.status === "open") ? " The pre-training quiz has been closed." : ""}`
      : `${q.title} is closed.`)

  async function remove() {
    const ok = await run(() => api(`${base}/${deleting.id}`, { method: "DELETE" }), "Quiz deleted.")
    if (ok) setDeleting(null)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Quiz</h1>
          <p>Attendees answer on their phone from their digital badge. Each person can submit once.</p>
        </div>
        <button onClick={() => setEditor({ title: NEW_TITLE[newKind], kind: newKind, passMark: 50, text: "" })}><Icon name="plus" />New quiz</button>
      </div>

      {!lastDay.allowed && (
        <p className="notice info">
          {firstDay.allowed ? "" : <>The pre-training quiz can be opened from {firstDay.time} on {formatDate(firstDay.date)}. </>}
          The post-training quiz can be opened from {lastDay.time} on {formatDate(lastDay.date)}, the last day, and opening it closes the pre-training quiz.
        </p>
      )}

      {!quizzes.length && (
        <div className="card empty stack" style={{ alignItems: "center" }}>
          <Icon name="quiz" size={28} />
          <p>No quizzes yet. Paste your questions to create one, for example a pre-test and a post-test.</p>
        </div>
      )}

      {quizzes.map((q) => {
        const [tone, label] = STATUS[q.status]
        const opening = q.kind === "post" ? lastDay : firstDay
        const c = q.comparison
        return (
          <section key={q.id} className="card">
            <div className="card-head">
              <div className="stack" style={{ gap: 4 }}>
                <div className="row"><h2>{q.title}</h2><span className="pill brand">{QUIZ_KINDS[q.kind]}</span><span className={`pill ${tone}`}>{label}</span></div>
                <p className="small">
                  {plural(q.questionCount, "question")} · pass mark {q.passMark}% · {plural(q.responses, "response")}
                  {q.average !== null && ` · average ${q.average}% · ${q.passed} passed`}
                </p>
                {c?.both > 0 && (
                  <p className="small"><strong>Before and after:</strong> {c.preAverage}% → {c.postAverage}% average for the {plural(c.both, "person", "people")} who took both · {c.improved} improved</p>
                )}
              </div>
              <div className="row">
                <a className="button secondary" href={`/admin/quiz-preview/${event.id}/${q.id}`} target="_blank" rel="noreferrer">Preview</a>
                {q.responses > 0 && <button className="secondary" disabled={busy} onClick={() => showResults(q)}>Results</button>}
                {q.status === "draft" && <button className="secondary" disabled={busy} onClick={() => edit(q)}><Icon name="edit" />Edit</button>}
                {q.kind === "pre" && !hasPost && <button className="secondary" disabled={busy} onClick={() => copyAsPost(q)}>Copy as post-training</button>}
                {q.status === "draft" && !q.responses && <button className="ghost" disabled={busy} onClick={() => setDeleting(q)}>Delete</button>}
                {q.status === "open"
                  ? <button className="secondary" disabled={busy} onClick={() => setStatus(q, "closed")}><Icon name="stop" />Close</button>
                  : <button disabled={busy || !opening.allowed} title={opening.allowed ? undefined : `Opens at ${opening.time} on ${formatDate(opening.date)}`}
                      onClick={() => setStatus(q, "open")}><Icon name="play" />{q.status === "draft" ? "Open quiz" : "Reopen"}</button>}
              </div>
            </div>
          </section>
        )
      })}

      <Dialog message={message} open={Boolean(editor)} title={editor?.id ? "Edit quiz" : "New quiz"} wide onClose={() => setEditor(null)}>
        {editor && (
          <form className="stack" onSubmit={save}>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 170px 120px" }}>
              <label htmlFor="q-title">Title<input id="q-title" required maxLength={120} value={editor.title} autoFocus
                placeholder="Pre-training quiz" onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label>
              <label htmlFor="q-kind">Type
                <select id="q-kind" value={editor.kind} onChange={(e) => setEditor({ ...editor, kind: e.target.value })}>
                  {Object.entries(QUIZ_KINDS).map(([k, l]) => <option key={k} value={k} disabled={k !== "other" && taken(k, editor.id)}>{l}</option>)}
                </select>
              </label>
              <label htmlFor="q-pass">Pass mark (%)<input id="q-pass" type="number" min={0} max={100} required value={editor.passMark}
                onChange={(e) => setEditor({ ...editor, passMark: e.target.value })} /></label>
            </div>
            <label htmlFor="q-text">
              Questions
              <textarea id="q-text" value={editor.text} style={{ minHeight: 240 }} placeholder={SAMPLE}
                onChange={(e) => setEditor({ ...editor, text: e.target.value })} />
              <span className="muted small" style={{ fontWeight: 400 }}>
                Number each question and letter each option. Mark the answer with &ldquo;Answer: B&rdquo;, a * after the option, or an answer key at the end. An optional &ldquo;Why:&rdquo; line, or text after the letter in the answer key, is shown to each person after they submit.
              </span>
            </label>
            {editor.text.trim() && (
              <div className="stack" style={{ gap: 8 }}>
                <p className={`notice ${parsed.check.ok ? "ok" : "warn"}`}>
                  {plural(parsed.questions.length, "question")} found{parsed.check.ok ? ", all with answers." : `. ${parsed.check.errors[0]}`}
                </p>
                {!parsed.check.ok && parsed.check.errors.length > 1 && (
                  <ul className="small field-error" style={{ margin: 0 }}>{parsed.check.errors.slice(1, 6).map((e) => <li key={e}>{e}</li>)}</ul>
                )}
                <div className="stack" style={{ gap: 8, maxHeight: 260, overflowY: "auto" }}>
                  {parsed.questions.slice(0, 50).map((q, i) => (
                    <div key={i} className="q-preview small">
                      <strong>{i + 1}. {q.text}</strong>
                      <ol type="A">{q.options.map((o, j) => <li key={j} className={j === q.answer ? "correct" : ""}>{o}</li>)}</ol>
                      {q.explanation && <div className="muted">Why: {q.explanation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="dialog-foot">
              <button type="button" className="secondary" onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" disabled={busy || !parsed.check.ok}>{editor.id ? "Save" : "Create quiz"}</button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog message={message} open={Boolean(results)} title={results?.quiz.title || ""} wide onClose={() => setResults(null)}>
        {results && (
          <div className="stack">
            <div className="stats">
              <div className="stat"><b>{results.quiz.responses}</b><span>Responses</span></div>
              <div className="stat"><b>{results.quiz.average ?? "—"}%</b><span>Average</span></div>
              <div className="stat"><b>{results.quiz.passed}</b><span>Passed ({results.quiz.passMark}%+)</span></div>
            </div>
            <div className="row spread">
              <h3>Questions</h3>
              <span className="muted small">Totals only. No names are shown here.</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table>
                <tbody>
                  {results.quiz.questions.map((q, i) => {
                    const s = results.perQuestion[i]
                    const pct = s.answered ? Math.round((s.correct / s.answered) * 100) : 0
                    return (
                      <tr key={i}>
                        <td className="small">
                          <strong>{i + 1}.</strong> {q.text}
                          <div className="muted">Answer {optionLetter(q.answer)}: {q.options[q.answer]}</div>
                          {q.explanation && <div className="muted">Key point: {q.explanation}</div>}
                          {s.answered > 0 && s.chosen && (
                            <div className="muted num">
                              {q.options.map((_, j) => `${optionLetter(j)}: ${s.chosen[j]}`).join(" · ")}
                            </div>
                          )}
                        </td>
                        <td style={{ width: 140 }}><div className="bar"><i style={{ width: `${pct}%` }} /></div></td>
                        <td className="num small" style={{ width: 110, whiteSpace: "nowrap" }}><b>{s.correct}</b> of {s.answered} right<br />{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="row spread">
              <h3>People</h3>
              <div className="row">
                <button type="button" className="secondary" onClick={() => setShowNames((v) => !v)}>{showNames ? "Hide names" : "Show names"}</button>
                <a className="button secondary" href={`${base}/${results.quiz.id}/csv`}><Icon name="download" />CSV</a>
              </div>
            </div>
            {showNames && (
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
                <table>
                  <tbody>
                    {results.responses.map((r) => (
                      <tr key={r.attendeeId}>
                        <td className="person"><b>{r.fullName}</b><span>{r.organization}</span></td>
                        <td className="num">{r.score}/{r.total}</td>
                        <td><span className={`pill ${r.passed ? "ok" : "warn"}`}>{r.percent}%</span></td>
                        <td className="small muted num">{formatDate(r.submittedAt).replace(/ \d{4}$/, "")} {formatTime(r.submittedAt, event.timezone)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog message={message} open={Boolean(deleting)} title="Delete quiz?" onClose={() => setDeleting(null)}>
        {deleting && (
          <div className="stack">
            <p>{deleting.title} will be deleted.</p>
            <div className="dialog-foot">
              <button className="secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="danger solid" disabled={busy} onClick={remove}>Delete</button>
            </div>
          </div>
        )}
      </Dialog>

      <Toast message={message} onClose={() => setMessage(null)} />
    </>
  )
}
