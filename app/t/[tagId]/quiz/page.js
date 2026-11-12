import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { findPublicTag } from "@/lib/server/services/documents.mjs"
import { quizzesForTag } from "@/lib/server/services/quizzes.mjs"
import { formatDate } from "@/lib/shared/format.mjs"
import { quizOpenFrom } from "@/lib/shared/quiz.mjs"

export const dynamic = "force-dynamic"
const WHEN = { pre: "Before the training", post: "After the training", other: "" }
export const metadata = { title: "Quiz", robots: { index: false, follow: false }, referrer: "no-referrer" }

// The quiz link in the badge email. It never changes. It lists every quiz of the event:
// the ones this person has done with their own score, the open ones still to do, and the
// closed ones they missed. With only one quiz in the event it goes straight to it.
export default async function QuizEntryPage({ params }) {
  const { tagId } = await params
  const found = await findPublicTag(tagId)
  if (!found) notFound()
  const { event, attendee } = found
  const quizzes = await quizzesForTag(event, attendee)
  if (quizzes.length === 1 && quizzes[0].status === "open") redirect(`/t/${attendee.tagId}/quiz/${quizzes[0].id}`)
  const opening = quizOpenFrom(event)
  const toDo = quizzes.filter((q) => !q.done && q.status === "open")
  const done = quizzes.filter((q) => q.done)
  const missed = quizzes.filter((q) => !q.done && q.status !== "open")

  return (
    <main className="public stack">
      <header className="stack" style={{ gap: 2 }}>
        <p className="eyebrow">{event.shortName || event.name}</p>
        <h1>My quizzes</h1>
        <p className="muted small">{attendee.fullName}</p>
      </header>

      {quizzes.length === 0 && (
        <p className="notice info">
          {opening.allowed
            ? "There is no quiz open right now. Please come back to this link when the facilitator asks you to."
            : `The quiz opens at ${opening.time} on ${formatDate(opening.date)}. Please come back to this link then.`}
        </p>
      )}

      {quizzes.length > 0 && (
        <p className="muted small">
          {done.length} of {quizzes.length} done{toDo.length ? ` · ${toDo.length} still to do` : ""}. Only you can see your scores.
        </p>
      )}

      {toDo.length > 0 && <h2>To do</h2>}
      {toDo.map((q) => (
        <Link key={q.id} className="quiz-link" href={`/t/${attendee.tagId}/quiz/${q.id}`}>
          <span>
            <strong>{q.title}</strong>
            <span className="muted small">{[WHEN[q.kind], `${q.questionCount} questions`].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="button">Start</span>
        </Link>
      ))}

      {done.length > 0 && <h2>Done</h2>}
      {done.map((q) => (
        <Link key={q.id} className="quiz-link" href={`/t/${attendee.tagId}/quiz/${q.id}`}>
          <span>
            <strong>{q.title}</strong>
            <span className="muted small">
              Your score: <b>{q.percent}%</b> ({q.score} of {q.total}) · {q.percent >= q.passMark ? "Passed" : `Pass mark ${q.passMark}%`}
            </span>
          </span>
          <span className="button secondary">See answers</span>
        </Link>
      ))}

      {missed.length > 0 && <h2>Closed</h2>}
      {missed.map((q) => (
        <div key={q.id} className="quiz-link" aria-disabled="true">
          <span>
            <strong>{q.title}</strong>
            <span className="muted small">You didn&apos;t take this quiz, and it is now closed.</span>
          </span>
          <span className="pill neutral">Closed</span>
        </div>
      ))}

      <Link className="muted small" href={`/t/${attendee.tagId}`}>Go to my badge</Link>
    </main>
  )
}
