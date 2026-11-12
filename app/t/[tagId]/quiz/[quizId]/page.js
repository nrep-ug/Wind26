import Link from "next/link"
import { notFound } from "next/navigation"
import { findPublicQuiz } from "@/lib/server/services/quizzes.mjs"
import QuizForm from "@/components/quiz/QuizForm"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quiz", robots: { index: false, follow: false }, referrer: "no-referrer" }

export default async function QuizPage({ params }) {
  const { tagId, quizId } = await params
  const found = await findPublicQuiz(tagId, quizId)
  if (!found) notFound()
  const { event, attendee, quiz, result } = found
  return (
    <main className="public stack">
      <header className="stack" style={{ gap: 2 }}>
        <p className="eyebrow">{event.shortName || event.name}</p>
        <h1>{quiz.title}</h1>
        <p className="muted small">{attendee.fullName}</p>
      </header>
      <QuizForm tagId={attendee.tagId} quiz={quiz} initialResult={result} />
      <Link className="muted small" href={`/t/${attendee.tagId}/quiz`}>All my quizzes</Link>
      <Link className="muted small" href={`/t/${attendee.tagId}`}>Back to my badge</Link>
    </main>
  )
}
