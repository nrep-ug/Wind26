import test from "node:test"
import assert from "node:assert/strict"
import { createEventScope } from "../lib/server/db/stores.mjs"
import { COLLECTIONS } from "../lib/server/db/schema.mjs"
import { compare, createQuiz, listQuizzes, previewQuiz, quizResults, recordResponse, setQuizStatus, updateQuiz } from "../lib/server/services/quizzes.mjs"
import { parseQuestions, publicQuestions, questionsToText, quizLayout, scoreAnswers, validateQuizInput } from "../lib/shared/quiz.mjs"
import { memoryStore } from "./memory-store.mjs"

const noAudit = async () => {}
const QUESTIONS = [
  { text: "Which part makes electricity?", options: ["Blade", "Generator", "Tower"], answer: 1 },
  { text: "What drives a wind turbine?", options: ["Moving air", "Sunlight"], answer: 0 },
]

test("questions are read from pasted text with answer lines, stars or an answer key", () => {
  const withLines = parseQuestions("Module 1\n1. Which part makes electricity?\nA. Blade\nB. Generator\nC. Tower\nAnswer: B\n\n2. What drives a wind turbine?\nA) Moving air\nB) Sunlight\nAnswer: A")
  assert.deepEqual(withLines, QUESTIONS)
  const withStars = parseQuestions("1. Which part makes electricity?\nA. Blade\nB. Generator *\nC. Tower\n2. What drives a wind turbine?\n*A. Moving air\nB. Sunlight")
  assert.deepEqual(withStars, QUESTIONS)
  // The Word document's answer table pastes as one value per line.
  const withKey = parseQuestions("1. Which part makes electricity?\nA. Blade\nB. Generator\nC. Tower\n2. What drives a wind turbine?\nA. Moving air\nB. Sunlight\nAnswer key\n1\nB\n2\nA")
  assert.deepEqual(withKey, QUESTIONS)
  assert.deepEqual(parseQuestions(questionsToText(QUESTIONS)), QUESTIONS)
})

test("an answer key copied from a PDF carries explanations, kept out of the public quiz", () => {
  const text = [
    "1. Which part makes",
    "electricity?",
    "A. The blade, which turns in",
    "the wind.",
    "B. The generator.",
    "2. What drives a turbine?",
    "A. Sunlight.",
    "B. Moving air.",
    "Answer Key and Assessment Guide",
    "Question Correct answer Key learning point",
    "1 B The generator turns rotation into",
    "electricity.",
    "2",
    "B",
    "Wind is moving air.",
  ].join("\n")
  const qs = parseQuestions(text)
  assert.equal(qs[0].text, "Which part makes electricity?")
  assert.equal(qs[0].options[0], "The blade, which turns in the wind.")
  assert.deepEqual(qs.map((q) => [q.answer, q.explanation]), [[1, "The generator turns rotation into electricity."], [1, "Wind is moving air."]])
  assert.equal(parseQuestions(questionsToText(qs))[1].explanation, "Wind is moving air.")
  assert.ok(!("explanation" in publicQuestions(qs)[0]))
})

test("a quiz needs a title, options and a marked answer for every question", () => {
  assert.equal(validateQuizInput({ title: "Post-test", passMark: 50, questions: QUESTIONS }).ok, true)
  const missing = validateQuizInput({ title: "Post-test", passMark: 50, questions: [{ text: "Q", options: ["A", "B"], answer: -1 }] })
  assert.match(missing.errors.join(" "), /no correct answer/)
  assert.match(validateQuizInput({ title: "", passMark: 50, questions: QUESTIONS }).errors.join(" "), /title/)
  assert.match(validateQuizInput({ title: "T", passMark: 50, questions: [{ text: "Q", options: ["only one"], answer: 0 }] }).errors.join(" "), /2 to 6 options/)
})

test("scoring needs every question answered with a real option", () => {
  assert.deepEqual(scoreAnswers(QUESTIONS, [1, 0]), { ok: true, score: 2, total: 2, answers: [1, 0] })
  assert.equal(scoreAnswers(QUESTIONS, [1, 1]).score, 1)
  assert.equal(scoreAnswers(QUESTIONS, [1]).ok, false)
  assert.equal(scoreAnswers(QUESTIONS, [1, 5]).ok, false)
  assert.equal(scoreAnswers(QUESTIONS, ["1", 0]).ok, false)
})

const STARTED = { startDate: "2020-01-01", endDate: "2020-01-03", timezone: "Africa/Kampala" }

async function setup() {
  const store = memoryStore()
  const a = createEventScope(store, "eventA")
  const b = createEventScope(store, "eventB")
  const grace = await a.create(COLLECTIONS.attendees, "grace", { fullName: "Grace Achieng", tagId: "t1", role: "participant" })
  const quiz = await createQuiz(a, { title: "Post-test", passMark: 50, questions: QUESTIONS }, noAudit)
  return { store, a, b, grace, quiz }
}

test("attendees answer an open quiz once, scored on the server", async () => {
  const { a, grace, quiz } = await setup()
  await assert.rejects(recordResponse(a, grace, quiz.id, [1, 0]), /Quiz not found/, "a draft quiz can't be answered")
  await setQuizStatus(a, STARTED, quiz.id, "open", noAudit)
  const { review, ...score } = await recordResponse(a, grace, quiz.id, [1, 1])
  assert.deepEqual(score, { score: 1, total: 2, percent: 50, passed: true })
  assert.deepEqual(review.map((q) => [q.chosen, q.answer]), [[1, 1], [1, 0]], "after submitting, they see their answer and the right one")
  await assert.rejects(recordResponse(a, grace, quiz.id, [1, 0]), /already submitted/)
  const results = await quizResults(a, quiz.id)
  assert.equal(results.responses.length, 1)
  assert.deepEqual(results.perQuestion, [{ correct: 1, answered: 1, chosen: [0, 1, 0] }, { correct: 0, answered: 1, chosen: [0, 1] }], "totals per question and per option, no names")
  await setQuizStatus(a, STARTED, quiz.id, "closed", noAudit)
  const peter = await a.create(COLLECTIONS.attendees, "peter", { fullName: "Peter Okello", tagId: "t2", role: "participant" })
  await assert.rejects(recordResponse(a, peter, quiz.id, [1, 0]), /closed/)
})

test("questions are locked once a quiz has been opened", async () => {
  const { a, quiz } = await setup()
  await updateQuiz(a, quiz.id, { title: "Pre-test", passMark: 60, questions: QUESTIONS }, noAudit)
  await setQuizStatus(a, STARTED, quiz.id, "open", noAudit)
  await assert.rejects(updateQuiz(a, quiz.id, { title: "Changed", passMark: 60, questions: QUESTIONS }, noAudit), /draft/)
  await assert.rejects(setQuizStatus(a, STARTED, quiz.id, "draft", noAudit), /can't be moved/)
})

test("another event's quiz can't be seen or answered", async () => {
  const { b, grace, quiz, store } = await setup()
  await setQuizStatus(createEventScope(store, "eventA"), STARTED, quiz.id, "open", noAudit)
  await assert.rejects(recordResponse(b, grace, quiz.id, [1, 0]), /Quiz not found/)
  await assert.rejects(quizResults(b, quiz.id), /Quiz not found/)
  assert.equal([...store.data.get(COLLECTIONS.quizResponses)?.values() || []].length, 0)
})

test("a quiz can't be opened before 08:00 on the first day of the event", async () => {
  const { a, quiz } = await setup()
  const event = { startDate: "2026-11-10", timezone: "Africa/Kampala", quizOpens: "08:00", checkinOpens: "07:00" }
  // Kampala is UTC+3: 23:30 on 9 Nov, then 07:59 and 08:00 on 10 Nov.
  for (const early of ["2026-11-09T20:30:00Z", "2026-11-10T04:59:00Z"]) {
    await assert.rejects(setQuizStatus(a, event, quiz.id, "open", noAudit, new Date(early)), /08:00/)
  }
  assert.equal((await a.get(COLLECTIONS.quizzes, quiz.id)).status, "draft")
  await setQuizStatus(a, event, quiz.id, "open", noAudit, new Date("2026-11-10T05:00:00Z"))
  assert.equal((await a.get(COLLECTIONS.quizzes, quiz.id)).status, "open")
})

test("the public quiz never carries the answers", () => {
  const shown = publicQuestions(QUESTIONS)
  assert.ok(shown.every((q) => !("answer" in q)))
})

test("an admin preview works on a draft and saves nothing", async () => {
  const { a, quiz, store } = await setup()
  const shown = await previewQuiz(a, quiz.id)
  assert.equal(shown.status, "draft")
  assert.deepEqual(shown.questions.map((q) => q.answer), [1, 0])
  assert.equal([...store.data.get(COLLECTIONS.quizResponses)?.values() || []].length, 0)
})

test("the badge email carries the attendee's fixed quiz link and the opening time", async () => {
  const { tagEmail } = await import("../lib/server/emails/templates.mjs")
  const event = { name: "Training", startDate: "2026-11-10", endDate: "2026-11-12", timezone: "Africa/Kampala", checkinOpens: "07:00", quizOpens: "08:00" }
  const mail = tagEmail({ event, attendee: { fullName: "Grace" }, link: "https://x.test/t/abc", quizLink: "https://x.test/t/abc/quiz", attached: false })
  for (const part of [mail.text, mail.html]) {
    assert.match(part, /https:\/\/x\.test\/t\/abc\/quiz/)
    assert.match(part, /opens at 08:00 on Tuesday 10 November/)
  }
})

const EVENT = { startDate: "2026-11-10", endDate: "2026-11-12", timezone: "Africa/Kampala", quizOpens: "08:00" }
const kampala = (date, time) => new Date(`${date}T${time}:00+03:00`)

test("pre-training comes first, post-training only on the last day and it closes the pre-training quiz", async () => {
  const { a, grace } = await setup()
  const pre = await createQuiz(a, { title: "Before", kind: "pre", passMark: 50, questions: QUESTIONS }, noAudit)
  const post = await createQuiz(a, { title: "After", kind: "post", passMark: 50, questions: QUESTIONS }, noAudit)
  await assert.rejects(createQuiz(a, { title: "Another", kind: "pre", passMark: 50, questions: QUESTIONS }, noAudit), /already a pre-training/)

  await setQuizStatus(a, EVENT, pre.id, "open", noAudit, kampala("2026-11-10", "08:00"))
  await assert.rejects(setQuizStatus(a, EVENT, post.id, "open", noAudit, kampala("2026-11-11", "15:00")), /last day/)
  await recordResponse(a, grace, pre.id, [0, 0])

  await setQuizStatus(a, EVENT, post.id, "open", noAudit, kampala("2026-11-12", "08:00"))
  assert.equal((await a.get(COLLECTIONS.quizzes, pre.id)).status, "closed", "opening the post-training quiz closes the pre-training one")
  await assert.rejects(setQuizStatus(a, EVENT, pre.id, "open", noAudit, kampala("2026-11-12", "09:00")), /post-training quiz is open/)
  await recordResponse(a, grace, post.id, [1, 0])

  const listed = await listQuizzes(a)
  assert.deepEqual(listed.filter((q) => q.kind !== "other").map((q) => q.kind), ["pre", "post"])
  assert.deepEqual(listed.find((q) => q.kind === "post").comparison, { both: 1, preAverage: 50, postAverage: 100, improved: 1 })
})

test("the before-and-after comparison only counts people who took both", () => {
  const r = (attendeeId, score) => ({ attendeeId, score, total: 10 })
  assert.deepEqual(compare([r("a", 4), r("b", 6)], [r("a", 8), r("c", 9)]), { both: 1, preAverage: 40, postAverage: 80, improved: 1 })
  assert.deepEqual(compare([], [r("a", 8)]), { both: 0, preAverage: null, postAverage: null, improved: 0 })
})

test("each attendee gets their own question order, and answers are marked against the saved quiz", () => {
  const questions = Array.from({ length: 12 }, (_, i) => ({
    text: `Question ${i + 1}`,
    options: i === 3 ? ["One", "Two", "Three", "All the above"] : ["One", "Two", "Three", "Four"],
    answer: i % 4,
  }))
  const a = quizLayout(questions, "quiz:grace")
  const b = quizLayout(questions, "quiz:peter")
  assert.deepEqual(quizLayout(questions, "quiz:grace").questions, a.questions, "the same person always sees the same order")
  assert.notDeepEqual(a.questions.map((q) => q.text), b.questions.map((q) => q.text), "two people see different orders")
  assert.deepEqual(a.questions.find((q) => q.text === "Question 4").options, questions[3].options, "'All the above' keeps its place")

  // Picking the right answer on screen scores full marks once mapped back.
  const shownRight = a.questions.map((q) => q.answer)
  const saved = a.toSaved(shownRight)
  assert.equal(scoreAnswers(questions, saved).score, 12)
  assert.deepEqual(a.toShown(saved), shownRight, "saved answers map back to what was on screen")
  // A wrong pick stays wrong.
  const oneWrong = [...shownRight]; oneWrong[0] = (oneWrong[0] + 1) % 4
  assert.equal(scoreAnswers(questions, a.toSaved(oneWrong)).score, 11)
  assert.equal(scoreAnswers(questions, a.toSaved([0, 1])).ok, false, "a short answer list is still rejected")
})
