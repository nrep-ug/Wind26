import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { currentStaff } from "@/lib/server/auth.mjs"
import { eventScope } from "@/lib/server/db/index.mjs"
import { getEvent } from "@/lib/server/services/events.mjs"
import { quizResults } from "@/lib/server/services/quizzes.mjs"
import { optionLetter } from "@/lib/shared/quiz.mjs"
import AutoRefresh from "@/components/quiz/AutoRefresh"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quiz results", robots: { index: false, follow: false } }

// A results screen for the projector: totals and per-question figures, never names.
export default async function QuizResultsScreen({ params }) {
  const staff = await currentStaff()
  if (!staff) redirect("/login")
  if (staff.role !== "admin") redirect("/scan")
  const { eventId, quizId } = await params
  let event, results
  try {
    event = await getEvent(eventId)
    results = await quizResults(eventScope(event.$id), quizId)
  } catch (error) {
    if (error?.status === 404) notFound()
    throw error
  }
  const { quiz, perQuestion, responses } = results
  const passRate = quiz.responses ? Math.round((quiz.passed / quiz.responses) * 100) : 0
  const bands = [[90, 100], [70, 89], [50, 69], [0, 49]].map(([lo, hi]) => ({
    label: lo === 90 ? "90–100%" : `${lo}–${hi}%`,
    count: responses.filter((r) => r.percent >= lo && r.percent <= hi).length,
  }))

  return (
    <main className="stack" style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 16px 56px" }}>
      <AutoRefresh seconds={15} />
      <header className="stack" style={{ gap: 2 }}>
        <p className="eyebrow">{event.shortName || event.name}</p>
        <h1>{quiz.title}: results</h1>
        <p className="muted small">{quiz.status === "open" ? "The quiz is open. This page updates every 15 seconds." : "The quiz is closed."} No names are shown.</p>
      </header>

      <div className="stats">
        <div className="stat"><b>{quiz.responses}</b><span>Responses</span></div>
        <div className="stat"><b>{quiz.average ?? "—"}%</b><span>Average score</span></div>
        <div className="stat"><b>{quiz.passed}</b><span>Passed ({quiz.passMark}% or more)</span></div>
        <div className="stat"><b>{passRate}%</b><span>Pass rate</span></div>
      </div>

      {quiz.responses > 0 && (
        <section className="card stack" style={{ gap: 8 }}>
          <h2>Scores</h2>
          {bands.map((b) => (
            <div key={b.label} className="row" style={{ gap: 12 }}>
              <span className="small" style={{ width: 80 }}>{b.label}</span>
              <div className="bar grow"><i style={{ width: `${quiz.responses ? (b.count / quiz.responses) * 100 : 0}%` }} /></div>
              <span className="num small" style={{ width: 70, textAlign: "right" }}>{b.count} {b.count === 1 ? "person" : "people"}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card stack" style={{ gap: 0 }}>
        <h2 style={{ marginBottom: 8 }}>Questions</h2>
        {quiz.questions.map((q, i) => {
          const s = perQuestion[i]
          const pct = s.answered ? Math.round((s.correct / s.answered) * 100) : 0
          return (
            <div key={i} className="stack" style={{ gap: 6, padding: "14px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div className="row spread" style={{ alignItems: "flex-start", gap: 16 }}>
                <strong className="grow">{i + 1}. {q.text}</strong>
                <span className="num" style={{ whiteSpace: "nowrap" }}><b>{pct}%</b> right <span className="muted small">({s.correct} of {s.answered})</span></span>
              </div>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <div className="small">Answer {optionLetter(q.answer)}: {q.options[q.answer]}</div>
              {q.explanation && <div className="small muted"><strong>Key point:</strong> {q.explanation}</div>}
              {s.answered > 0 && (
                <div className="small muted num">Chosen: {q.options.map((_, j) => `${optionLetter(j)} ${s.chosen[j]}`).join(" · ")}</div>
              )}
            </div>
          )
        })}
      </section>
      <Link className="muted small" href="/admin#quiz">Back to the dashboard</Link>
    </main>
  )
}
