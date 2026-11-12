import "server-only"
import crypto from "node:crypto"
import { COLLECTIONS, Query, eventScope } from "../db/index.mjs"
import { badRequest, conflict, notFound } from "../errors.mjs"
import { newDocId } from "./events.mjs"
import { findPublicTag } from "./documents.mjs"
import { csvCell } from "../../shared/attendance.mjs"
import { QUIZ_KINDS, QUIZ_LAYOUT, byKind, percent, publicQuestions, quizKind, quizLayout, quizOpenFrom, reviewAnswers, scoreAnswers, validateQuizInput } from "../../shared/quiz.mjs"
import { formatDate } from "../../shared/format.mjs"
import { cleanText } from "../../shared/validation.mjs"

const STATUS_FLOW = { draft: ["open"], open: ["closed"], closed: ["open"] }

// One response per attendee per quiz, enforced by the document ID.
export function responseDocId(eventId, quizId, attendeeId) {
  return crypto.createHash("sha256").update(`quiz:${eventId}:${quizId}:${attendeeId}`).digest("hex").slice(0, 32)
}

const readQuestions = (quiz) => JSON.parse(quiz.questions)

function summary(quiz, responses) {
  const scores = responses.map((r) => percent(r.score, r.total))
  return {
    id: quiz.$id, title: quiz.title, kind: quizKind(quiz), status: quiz.status, questionCount: quiz.questionCount, passMark: quiz.passMark,
    openedAt: quiz.openedAt || null, closedAt: quiz.closedAt || null,
    responses: responses.length,
    average: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    passed: scores.filter((s) => s >= quiz.passMark).length,
  }
}

const byCreated = (a, b) => String(a.$createdAt).localeCompare(String(b.$createdAt))

// Pre-training first, post-training last. The post-training quiz carries the before-and-after comparison.
export async function listQuizzes(db) {
  const [quizzes, responses] = await Promise.all([db.listAll(COLLECTIONS.quizzes), db.listAll(COLLECTIONS.quizResponses)])
  const forQuiz = (q) => responses.filter((r) => r.quizId === q.$id)
  const pre = quizzes.find((q) => quizKind(q) === "pre")
  return quizzes
    .sort((a, b) => byKind(a, b) || byCreated(a, b))
    .map((q) => {
      const item = summary(q, forQuiz(q))
      if (quizKind(q) === "post" && pre) item.comparison = compare(forQuiz(pre), forQuiz(q))
      return item
    })
}

// Only people who took both count, so the averages describe the same group before and after.
export function compare(preResponses, postResponses) {
  const before = new Map(preResponses.map((r) => [r.attendeeId, percent(r.score, r.total)]))
  const pairs = postResponses.filter((r) => before.has(r.attendeeId)).map((r) => [before.get(r.attendeeId), percent(r.score, r.total)])
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null)
  return {
    both: pairs.length,
    preAverage: avg(pairs.map(([a]) => a)),
    postAverage: avg(pairs.map(([, b]) => b)),
    improved: pairs.filter(([a, b]) => b > a).length,
  }
}

// An event has at most one pre-training and one post-training quiz.
async function assertKindFree(db, kind, exceptId = "") {
  if (kind === "other") return
  const taken = (await db.listAll(COLLECTIONS.quizzes)).some((q) => q.$id !== exceptId && quizKind(q) === kind)
  if (taken) throw conflict(`There is already a ${QUIZ_KINDS[kind].toLowerCase()} quiz. Change its type or choose Other.`, "quiz_kind_taken")
}

async function loadQuiz(db, quizId) {
  const quiz = await db.get(COLLECTIONS.quizzes, cleanText(quizId, 36))
  if (!quiz) throw notFound("Quiz not found.")
  return quiz
}

function checked(input) {
  const result = validateQuizInput(input)
  if (!result.ok) throw badRequest(result.errors[0], "invalid_quiz", { problems: result.errors })
  return result.value
}

export async function createQuiz(db, input, audit) {
  const value = checked(input)
  await assertKindFree(db, value.kind)
  const doc = await db.create(COLLECTIONS.quizzes, newDocId(), {
    title: value.title, kind: value.kind, status: "draft", passMark: value.passMark,
    questions: JSON.stringify(value.questions), questionCount: value.questions.length,
  })
  await audit({ action: "quiz.create", targetId: doc.$id, details: { title: value.title, questions: value.questions.length } })
  return summary(doc, [])
}

// Questions are fixed once anyone can answer, so every response is scored against the same quiz.
export async function updateQuiz(db, quizId, input, audit) {
  const quiz = await loadQuiz(db, quizId)
  if (quiz.status !== "draft") throw conflict("Questions can only be changed while the quiz is a draft.")
  if (await db.count(COLLECTIONS.quizResponses, [Query.equal("quizId", quiz.$id)])) throw conflict("This quiz already has responses.")
  const value = checked(input)
  await assertKindFree(db, value.kind, quiz.$id)
  const updated = await db.update(COLLECTIONS.quizzes, quiz.$id, {
    title: value.title, kind: value.kind, passMark: value.passMark, questions: JSON.stringify(value.questions), questionCount: value.questions.length,
  })
  await audit({ action: "quiz.update", targetId: quiz.$id, details: { title: value.title, questions: value.questions.length } })
  return summary(updated, [])
}

export async function setQuizStatus(db, event, quizId, status, audit, now = new Date()) {
  const quiz = await loadQuiz(db, quizId)
  if (!(STATUS_FLOW[quiz.status] || []).includes(status)) throw badRequest(`A quiz that is ${quiz.status} can't be moved to ${status}.`)
  const kind = quizKind(quiz)
  const at = now.toISOString()
  if (status === "open") {
    const window = quizOpenFrom(event, now, kind)
    if (!window.allowed) {
      const which = kind === "post" ? "Post-training quizzes" : "Quizzes"
      throw conflict(`${which} can be opened from ${window.time} on ${formatDate(window.date)}, the ${window.lastDay ? "last" : "first"} day of the event.`, "quiz_too_early")
    }
    const others = await db.listAll(COLLECTIONS.quizzes, [Query.equal("status", "open")])
    if (kind === "pre" && others.some((q) => quizKind(q) === "post")) {
      throw conflict("The post-training quiz is open, so the pre-training quiz can't be reopened.", "post_quiz_open")
    }
    // Once the training is over the pre-training quiz no longer measures the starting point.
    if (kind === "post") {
      for (const pre of others.filter((q) => quizKind(q) === "pre")) {
        await db.update(COLLECTIONS.quizzes, pre.$id, { status: "closed", closedAt: at })
        await audit({ action: "quiz.close", targetId: pre.$id, details: { title: pre.title, reason: "post-training quiz opened" } })
      }
    }
  }
  await db.update(COLLECTIONS.quizzes, quiz.$id, status === "open" ? { status, openedAt: at, closedAt: null } : { status, closedAt: at })
  await audit({ action: `quiz.${status === "open" ? "open" : "close"}`, targetId: quiz.$id, details: { title: quiz.title } })
}

export async function deleteQuiz(db, quizId, audit) {
  const quiz = await loadQuiz(db, quizId)
  if (await db.count(COLLECTIONS.quizResponses, [Query.equal("quizId", quiz.$id)])) {
    throw conflict("This quiz has responses, so it can't be deleted. Close it instead.")
  }
  await db.remove(COLLECTIONS.quizzes, quiz.$id)
  await audit({ action: "quiz.delete", targetId: quiz.$id, details: { title: quiz.title } })
}

// Admin view: the full quiz with answers, each response, and how many got each question right.
export async function quizResults(db, quizId) {
  const quiz = await loadQuiz(db, quizId)
  const [responses, attendees] = await Promise.all([
    db.listAll(COLLECTIONS.quizResponses, [Query.equal("quizId", quiz.$id)]),
    db.listAll(COLLECTIONS.attendees),
  ])
  const questions = readQuestions(quiz)
  const byId = new Map(attendees.map((a) => [a.$id, a]))
  const answers = responses.map((r) => JSON.parse(r.answers))
  return {
    quiz: { ...summary(quiz, responses), questions },
    responses: responses
      .map((r) => {
        const a = byId.get(r.attendeeId)
        return {
          attendeeId: r.attendeeId, fullName: a?.fullName || "Removed attendee", organization: a?.organization || "",
          score: r.score, total: r.total, percent: percent(r.score, r.total), passed: percent(r.score, r.total) >= quiz.passMark,
          submittedAt: r.submittedAt,
        }
      })
      .sort((x, y) => y.percent - x.percent || x.fullName.localeCompare(y.fullName)),
    // Totals only, no names: how many got each question right and how many picked each option.
    perQuestion: questions.map((q, i) => ({
      correct: answers.filter((a) => a[i] === q.answer).length,
      answered: answers.length,
      chosen: q.options.map((_, j) => answers.filter((a) => a[i] === j).length),
    })),
  }
}

export async function quizResultsCsv(db, quizId) {
  const { quiz, responses } = await quizResults(db, quizId)
  const lines = [["Name", "Organisation", "Score", "Out of", "Percent", "Passed", "Submitted"].map(csvCell).join(",")]
  for (const r of responses) {
    lines.push([r.fullName, r.organization, r.score, r.total, r.percent, r.passed ? "Yes" : "No", r.submittedAt].map(csvCell).join(","))
  }
  return { title: quiz.title, csv: lines.join("\r\n") + "\r\n" }
}

// Attendees reach quizzes through their own tag link, so the tag UUID identifies them.
export async function openQuizzesForTag(event, attendee) {
  return quizzesForTag(event, attendee, ["open"])
}

// Every quiz the attendee can see: open ones to take, and closed ones that show their own score.
// Drafts are never listed. Scores come only from this attendee's own responses.
export async function quizzesForTag(event, attendee, statuses = ["open", "closed"]) {
  const db = eventScope(event.$id)
  const quizzes = (await db.listAll(COLLECTIONS.quizzes, [Query.equal("status", statuses)])).sort((a, b) => byKind(a, b) || byCreated(a, b))
  const responses = await Promise.all(quizzes.map((q) => db.get(COLLECTIONS.quizResponses, responseDocId(event.$id, q.$id, attendee.$id))))
  return quizzes.map((q, i) => {
    const response = responses[i]
    return {
      id: q.$id, title: q.title, kind: quizKind(q), status: q.status, questionCount: q.questionCount, passMark: q.passMark,
      done: Boolean(response), score: response?.score ?? null, total: response?.total ?? null,
      percent: response ? percent(response.score, response.total) : null,
    }
  })
}

export async function findPublicQuiz(tagId, quizId) {
  const found = await findPublicTag(tagId)
  if (!found) return null
  const { event, attendee } = found
  const db = eventScope(event.$id)
  const quiz = await db.get(COLLECTIONS.quizzes, cleanText(quizId, 36))
  if (!quiz || quiz.status === "draft") return null
  const response = await db.get(COLLECTIONS.quizResponses, responseDocId(event.$id, quiz.$id, attendee.$id))
  const layout = attendeeLayout(quiz, attendee)
  return {
    event, attendee,
    // Correct answers leave the server only for someone who has already submitted.
    quiz: { id: quiz.$id, title: quiz.title, status: quiz.status, passMark: quiz.passMark, layout: QUIZ_LAYOUT, questions: publicQuestions(layout.questions) },
    result: response
      ? { score: response.score, total: response.total, percent: percent(response.score, response.total), review: reviewAnswers(layout.questions, layout.toShown(JSON.parse(response.answers))) }
      : null,
  }
}

const attendeeLayout = (quiz, attendee) => quizLayout(readQuestions(quiz), `${quiz.$id}:${attendee.$id}`)

// A page loaded before shuffling existed sends no layout; its answers are already in saved order.
export async function submitQuiz(tagId, quizId, answersInput, layoutName = "") {
  const found = await findPublicTag(tagId)
  if (!found) throw notFound("This link isn't valid.")
  const db = eventScope(found.event.$id)
  if (layoutName !== QUIZ_LAYOUT) return recordResponse(db, found.attendee, quizId, answersInput)
  const quiz = await db.get(COLLECTIONS.quizzes, cleanText(quizId, 36))
  if (!quiz) throw notFound("Quiz not found.")
  const layout = attendeeLayout(quiz, found.attendee)
  const result = await recordResponse(db, found.attendee, quizId, layout.toSaved(answersInput))
  return { ...result, review: reviewAnswers(layout.questions, answersInput) }
}

export async function recordResponse(db, attendee, quizId, answersInput) {
  const quiz = await db.get(COLLECTIONS.quizzes, cleanText(quizId, 36))
  if (!quiz || quiz.status === "draft") throw notFound("Quiz not found.")
  if (quiz.status !== "open") throw conflict("This quiz is closed.", "quiz_closed")
  const questions = readQuestions(quiz)
  const scored = scoreAnswers(questions, answersInput)
  if (!scored.ok) throw badRequest(scored.message)
  const result = { score: scored.score, total: scored.total, percent: percent(scored.score, scored.total) }
  try {
    await db.create(COLLECTIONS.quizResponses, responseDocId(db.eventId, quiz.$id, attendee.$id), {
      quizId: quiz.$id, attendeeId: attendee.$id, answers: JSON.stringify(scored.answers),
      score: scored.score, total: scored.total, submittedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error?.status !== 409) throw error
    throw conflict("You have already submitted this quiz.", "already_submitted")
  }
  return { ...result, passed: result.percent >= quiz.passMark, review: reviewAnswers(questions, scored.answers) }
}

// Admin preview: the attendee's view of the quiz, with the answer key so it can be marked in the browser.
// Nothing is saved, and it works for drafts and before the quiz unlocks.
export async function previewQuiz(db, quizId) {
  const quiz = await loadQuiz(db, quizId)
  return { id: quiz.$id, title: quiz.title, kind: quizKind(quiz), status: quiz.status, passMark: quiz.passMark, questions: readQuestions(quiz) }
}
