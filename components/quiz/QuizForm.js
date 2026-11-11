"use client"

import { useState } from "react"
import { api } from "@/components/api"
import { percent, reviewAnswers, scoreAnswers } from "@/lib/shared/quiz.mjs"

const LETTERS = "ABCDEF"

// preview: an admin trying the quiz. quiz.questions then include the answers, and nothing is sent.
export default function QuizForm({ tagId, quiz, initialResult, preview = false }) {
  const [answers, setAnswers] = useState(() => quiz.questions.map(() => -1))
  const [result, setResult] = useState(initialResult)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const answered = answers.filter((a) => a >= 0).length

  if (result) {
    const passed = result.percent >= quiz.passMark
    return (
      <div className="stack">
        <div className={`score-card ${passed ? "ok" : "warn"}`} role="status">
          <span className="score">{result.percent}%</span>
          <span>{result.score} of {result.total} correct</span>
          <span className="muted small">{preview ? "Preview only. Nothing was saved." : "Your answers have been recorded. Thank you."}</span>
        </div>
        {preview && (
          <button type="button" className="secondary" onClick={() => { setResult(null); setAnswers(quiz.questions.map(() => -1)); window.scrollTo({ top: 0 }) }}>Try again</button>
        )}
        {result.review?.length > 0 && <h2>Your answers</h2>}
        {result.review?.map((q, i) => {
          const right = q.chosen === q.answer
          return (
            <div key={i} className="question">
              <div className="review-head">
                <span className="qnum">{i + 1}</span>
                <span className="grow">{q.text}</span>
                <span className={`pill ${right ? "ok" : "bad"}`}>{right ? "Correct" : "Wrong"}</span>
              </div>
              {q.options.map((option, j) => {
                const tone = j === q.answer ? "right" : j === q.chosen ? "wrong" : ""
                return (
                  <div key={j} className={`option review ${tone}`}>
                    <span className="letter">{LETTERS[j]}</span>
                    <span className="grow">{option}</span>
                    {j === q.chosen && <span className="small">Your answer</span>}
                    {j === q.answer && j !== q.chosen && <span className="small">Correct answer</span>}
                  </div>
                )
              })}
              {q.explanation && <p className="small muted" style={{ margin: "8px 0 0" }}><strong>Key point:</strong> {q.explanation}</p>}
            </div>
          )
        })}
      </div>
    )
  }
  if (!preview && quiz.status !== "open") return <p className="notice warn">This quiz is closed.</p>

  async function submit(e) {
    e.preventDefault()
    const missing = answers.findIndex((a) => a < 0)
    if (missing >= 0) {
      setError(`Answer question ${missing + 1} before submitting.`)
      document.getElementById(`q-${missing}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    if (preview) {
      const scored = scoreAnswers(quiz.questions, answers)
      setResult({ score: scored.score, total: scored.total, percent: percent(scored.score, scored.total), review: reviewAnswers(quiz.questions, answers) })
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    setBusy(true)
    setError("")
    try {
      setResult(await api(`/api/public/quizzes/${tagId}/${quiz.id}`, { method: "POST", body: { answers, layout: quiz.layout } }))
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {quiz.questions.map((q, i) => (
        <fieldset key={i} id={`q-${i}`} className="question">
          <legend><span className="qnum">{i + 1}</span>{q.text}</legend>
          {q.options.map((option, j) => (
            <label key={j} className={`option ${answers[i] === j ? "chosen" : ""}`}>
              <input type="radio" name={`q${i}`} checked={answers[i] === j}
                onChange={() => setAnswers((prev) => prev.map((a, k) => (k === i ? j : a)))} />
              <span className="letter">{LETTERS[j]}</span>
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <div className="submit-bar">
        <span className="muted small">{answered} of {quiz.questions.length} answered</span>
        <button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit answers"}</button>
      </div>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <p className="muted small">{preview ? "Attendees can submit once." : "You can submit once."}</p>
    </form>
  )
}
