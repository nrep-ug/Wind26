import { cleanText } from "./validation.mjs"
import { localParts } from "./event-days.mjs"

export const QUIZ_LIMITS = Object.freeze({ questions: 100, minOptions: 2, maxOptions: 6, text: 500, option: 200, title: 120, explanation: 500 })
const LETTERS = "ABCDEF"

// A pre-training quiz is taken before the sessions and a post-training quiz after them,
// so the two can be compared. Each event has at most one of each.
export const QUIZ_KINDS = Object.freeze({ pre: "Pre-training", post: "Post-training", other: "Other" })
const KIND_ORDER = { pre: 0, other: 1, post: 2 }
export const quizKind = (quiz) => (quiz?.kind in QUIZ_KINDS ? quiz.kind : "other")
export const byKind = (a, b) => KIND_ORDER[quizKind(a)] - KIND_ORDER[quizKind(b)]

// Reads multiple-choice questions pasted as plain text, e.g. from a Word document:
//
//   1. What converts rotation into electricity?
//   A. Rotor blade
//   B. Generator *          a trailing (or leading) * marks the correct option
//   Answer: B               or an answer line after the options
//   Why: The generator ...  an optional explanation, shown after submitting
//
// An answer key at the end also works: a line "Answers" or "Answer key",
// followed by pairs such as "1 B", "2. C" or one value per line. A key line may
// carry the explanation after the letter ("1 B Wind power varies with ..."),
// and the lines that follow it continue that explanation.
export function parseQuestions(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/ /g, " ").trim()).filter(Boolean)
  const questions = []
  const keyTokens = []
  let current = null
  let inKey = false
  let lastKey = null
  let pendingNumber = ""
  const byNumber = (n) => questions.find((x) => x.number === n)

  for (const line of lines) {
    if (/^(answers?|answer key|key)\s*:?$|^answer key\b[^:]*$/i.test(line)) { inKey = true; continue }
    if (inKey) {
      // "3 A Explanation", "3 A" (explanation on the next lines), or "3" and "A" on separate lines.
      if (/^\d{1,3}$/.test(line)) { pendingNumber = line; lastKey = null; continue }
      const k = `${pendingNumber} ${line}`.trim().match(/^(\d{1,3})\s*[.):-]?\s*([A-F])(?:(?:\s*[.):–-]\s*|\s+)([A-Za-z(].{3,}))?$/i)
      pendingNumber = ""
      if (k) {
        lastKey = byNumber(Number(k[1])) || null
        if (lastKey && lastKey.answer < 0) lastKey.answer = LETTERS.indexOf(k[2].toUpperCase())
        if (lastKey && k[3]) lastKey.explanation = k[3]
        continue
      }
      // A following line continues the explanation ("2 MW."), unless it is itself a key entry ("4 B").
      if (lastKey && !/^\d{1,3}\s*[.):-]?\s*[A-F]\b/i.test(line)) { lastKey.explanation = `${lastKey.explanation || ""} ${line}`.trim(); continue }
      lastKey = null
      keyTokens.push(...(line.match(/\d+|\b[A-F]\b/gi) || []))
      continue
    }

    const why = line.match(/^(?:why|explanation|key (?:learning )?point|learning point)\s*[:-]\s*(.+)$/i)
    if (why) { if (current) current.explanation = why[1]; continue }

    let m = line.match(/^(?:answer|correct(?: answer)?)\s*[:\-]\s*([A-F])\b/i)
    if (m) { if (current) current.answer = LETTERS.indexOf(m[1].toUpperCase()); continue }

    // "9. What…", and "9.What…" when a PDF drops the space (but not "2.5 MW…").
    m = line.match(/^(?:Q\s*)?(\d{1,3})\s*[.)](?:\s+|(?=[A-Za-z]))(.+)$/i)
    if (m) { current = { number: Number(m[1]), text: m[2], options: [], answer: -1 }; questions.push(current); continue }

    m = line.match(/^(\*?)\s*([A-F])\s*[.)]\s+(.+?)\s*(\*?)$/i)
    if (m && current) {
      if (m[1] || m[4]) current.answer = current.options.length
      current.options.push(m[3])
      continue
    }
    // Text before the first option continues the question. After an option, a line continues it when
    // the option was cut mid-sentence (copied from a PDF); anything else (module headings) is ignored.
    if (current && !current.options.length) current.text += ` ${line}`
    else if (current && (!/[.?!:)]$/.test(current.options.at(-1)) || /^[a-z]/.test(line))) current.options[current.options.length - 1] += ` ${line}`
  }

  for (let i = 0; i + 1 < keyTokens.length; i += 1) {
    if (!/^\d+$/.test(keyTokens[i]) || !/^[A-F]$/i.test(keyTokens[i + 1])) continue
    const q = byNumber(Number(keyTokens[i]))
    if (q && q.answer < 0) q.answer = LETTERS.indexOf(keyTokens[i + 1].toUpperCase())
    i += 1
  }
  return questions.map(({ text: t, options, answer, explanation }) => (explanation ? { text: t, options, answer, explanation } : { text: t, options, answer }))
}

// Returns cleaned questions and a list of problems, one line per question.
export function validateQuestions(input) {
  const errors = []
  const list = Array.isArray(input) ? input : []
  if (!list.length) errors.push("Add at least one question.")
  if (list.length > QUIZ_LIMITS.questions) errors.push(`A quiz can have at most ${QUIZ_LIMITS.questions} questions.`)
  const questions = list.slice(0, QUIZ_LIMITS.questions).map((q, i) => {
    const text = cleanText(q?.text, QUIZ_LIMITS.text)
    const options = (Array.isArray(q?.options) ? q.options : []).map((o) => cleanText(o, QUIZ_LIMITS.option)).filter(Boolean)
    const answer = Number(q?.answer)
    const n = i + 1
    if (!text) errors.push(`Question ${n} has no text.`)
    if (options.length < QUIZ_LIMITS.minOptions || options.length > QUIZ_LIMITS.maxOptions) {
      errors.push(`Question ${n} needs ${QUIZ_LIMITS.minOptions} to ${QUIZ_LIMITS.maxOptions} options.`)
    }
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) errors.push(`Question ${n} has no correct answer marked.`)
    const explanation = cleanText(q?.explanation, QUIZ_LIMITS.explanation)
    return explanation ? { text, options, answer, explanation } : { text, options, answer }
  })
  return { ok: errors.length === 0, questions, errors }
}

export function validateQuizInput(input) {
  const title = cleanText(input?.title, QUIZ_LIMITS.title)
  const passMark = Number(input?.passMark ?? 50)
  const result = validateQuestions(input?.questions)
  const errors = [...result.errors]
  if (title.length < 2) errors.unshift("Give the quiz a title.")
  if (!Number.isInteger(passMark) || passMark < 0 || passMark > 100) errors.push("The pass mark must be a whole number from 0 to 100.")
  const kind = input?.kind ?? "other"
  if (!(kind in QUIZ_KINDS)) errors.push("Choose pre-training, post-training or other.")
  return { ok: errors.length === 0, value: { title, passMark, kind, questions: result.questions }, errors }
}

// What an attendee sees: the questions without the answers.
// Each attendee sees the questions, and the options within them, in their own order, so
// people sitting together don't see the same screen. The order comes from a seed (quiz and
// attendee), so the server can map answers back without storing anything. Options that point
// at other options ("All the above", "Both A and B") keep their question's original order.
export const QUIZ_LAYOUT = "shuffle-1"
const KEEP_OPTION_ORDER = /\b(above|below|both|neither)\b|\b(all|none) of the\b/i

function seededRandom(seed) {
  let h = 2166136261
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffledIndexes(n, random) {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function quizLayout(questions, seed) {
  const random = seededRandom(seed)
  const order = shuffledIndexes(questions.length, random)
  const optionOrder = order.map((qi) => {
    const options = questions[qi].options
    return options.some((o) => KEEP_OPTION_ORDER.test(o)) ? options.map((_, j) => j) : shuffledIndexes(options.length, random)
  })
  return {
    questions: order.map((qi, i) => {
      const q = questions[qi]
      const shown = { ...q, options: optionOrder[i].map((j) => q.options[j]) }
      if (Number.isInteger(q.answer)) shown.answer = optionOrder[i].indexOf(q.answer)
      return shown
    }),
    // Answers as shown on screen -> answers in the quiz's saved order.
    toSaved(shownAnswers) {
      if (!Array.isArray(shownAnswers) || shownAnswers.length !== questions.length) return shownAnswers
      const saved = questions.map(() => -1)
      order.forEach((qi, i) => {
        const a = shownAnswers[i]
        saved[qi] = Number.isInteger(a) && a >= 0 && a < optionOrder[i].length ? optionOrder[i][a] : a
      })
      return saved
    },
    // Saved answers -> the order this attendee saw.
    toShown(savedAnswers) {
      return order.map((qi, i) => {
        const a = savedAnswers?.[qi]
        return Number.isInteger(a) && a >= 0 ? optionOrder[i].indexOf(a) : a
      })
    },
  }
}

export function publicQuestions(questions) {
  return questions.map((q) => ({ text: q.text, options: q.options }))
}

// Every question must be answered with the index of one of its options.
export function scoreAnswers(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) return { ok: false, message: "Answer every question before submitting." }
  let score = 0
  for (let i = 0; i < questions.length; i += 1) {
    const a = answers[i]
    if (!Number.isInteger(a) || a < 0 || a >= questions[i].options.length) return { ok: false, message: `Choose an answer for question ${i + 1}.` }
    if (a === questions[i].answer) score += 1
  }
  return { ok: true, score, total: questions.length, answers }
}

// The inverse of parseQuestions, for editing a saved quiz as text.
export function questionsToText(questions) {
  return questions.map((q, i) => [
    `${i + 1}. ${q.text}`,
    ...q.options.map((o, j) => `${LETTERS[j]}. ${o}`),
    `Answer: ${LETTERS[q.answer] || ""}`,
    ...(q.explanation ? [`Why: ${q.explanation}`] : []),
  ].join("\n")).join("\n\n")
}

export const percent = (score, total) => (total ? Math.round((score / total) * 100) : 0)
export const optionLetter = (i) => LETTERS[i] || "?"

// Quizzes can be opened from quizOpens (HH:MM) in the event's own timezone: on the first day,
// or on the last day for a post-training quiz. Without quizOpens they unlock when check-in opens.
export function quizOpenFrom(event, now = new Date(), kind = "other") {
  const time = event.quizOpens || event.checkinOpens || "00:00"
  const day = kind === "post" ? event.endDate || event.startDate : event.startDate
  const [h, m] = time.split(":").map(Number)
  const { date, minutes } = localParts(event.timezone, now)
  const allowed = date > day || (date === day && minutes >= h * 60 + m)
  return { date: day, time, allowed, lastDay: kind === "post" }
}

// Shown to an attendee only after they have submitted: their choice next to the right answer,
// and the explanation when the quiz has one.
export function reviewAnswers(questions, answers) {
  return questions.map((q, i) => ({ text: q.text, options: q.options, answer: q.answer, chosen: answers[i], explanation: q.explanation || "" }))
}
