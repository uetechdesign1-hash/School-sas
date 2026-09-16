import { NextRequest, NextResponse } from "next/server";

import {
  buildAnswer,
  suggestionsForPage,
} from "@/lib/chat/knowledge-base";

/**
 * =========================================================
 * EduNexa Assistant - Chat API
 * =========================================================
 *
 * POST /api/chat
 *
 * Body:
 *   { "message": "how do I add a student?", "page": "/dashboard/students/new" }
 *
 * Response:
 *   {
 *     "answer":      ChatAnswer   (guide steps, tips, page link, ...)
 *     "suggestions": string[]     (follow-up questions)
 *   }
 *
 * The assistant is fully offline: it matches the message
 * against the curated EduNexa knowledge base. No external
 * AI API is called, so there is no cost or API key needed.
 */

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const message = readString(record.message).trim().slice(0, 500);
    const page = readString(record.page).slice(0, 200);

    if (!message) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 },
      );
    }

    const answer = buildAnswer(message, page);
    const suggestions = suggestionsForPage(page);

    return NextResponse.json({ answer, suggestions });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
}