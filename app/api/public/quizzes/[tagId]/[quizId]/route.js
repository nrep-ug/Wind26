export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { route, json, readJson } from "@/lib/server/http.mjs"
import { submitQuiz } from "@/lib/server/services/quizzes.mjs"

// The attendee's own tag ID identifies them. Each attendee can submit once.
export const POST = route(async (request, { tagId, quizId }) => {
  const body = await readJson(request)
  return json(await submitQuiz(tagId, quizId, body.answers, typeof body.layout === "string" ? body.layout : ""))
})
