"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Bot,
  MessagesSquare,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import {
  ChatAnswer,
  suggestionsForPage,
} from "@/lib/chat/knowledge-base";

/* A round floating button (bottom-right) that opens the
   EduNexa Assistant chat panel. Answers come from the
   offline EduNexa knowledge base - no API key needed. */

type ChatMessage = {
  id: number;
  role: "user" | "bot";
  text: string;
  answer?: ChatAnswer;
};

let nextMessageId = 1;

const WELCOME_ANSWER: ChatAnswer = {
  kind: "smalltalk",
  text: "Hi, I'm the EduNexa Assistant 👋 — your step-by-step guide to every page in EduNexa. Ask me what to enter on a page, how to do a task, or what a button does. For example:",
  steps: [
    "How do I add a student?",
    "What should I enter on this page?",
    "How do I collect fees?",
    "How do I run payroll?",
  ],
};

const DEFAULT_SUGGESTIONS = [
  "What do I need to set up first?",
  "How do I add a student?",
  "How do I collect fees?",
  "How do I run payroll?",
];

function newId() {
  return nextMessageId++;
}

/* =========================================================
   Message renderers
   ========================================================= */

function BotAvatar() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white">
      <Bot size={15} strokeWidth={2.5} />
    </span>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-blue-600 px-3.5 py-2.5 text-[13.5px] leading-snug text-white shadow-sm">
        {text}
      </div>
    </div>
  );
}

function BotBubble({ message }: { message: ChatMessage }) {
  const answer = message.answer;
  return (
    <div className="flex items-end gap-2">
      <BotAvatar />
      <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-slate-700 shadow-sm">
        <p>{message.text}</p>
        {answer && <AnswerBody answer={answer} />}
      </div>
    </div>
  );
}

/**
 * Dynamic routes (student/staff detail pages) contain a
 * literal "[id]" placeholder that can never be navigated to.
 * Fall back to the nearest real page so links never 404.
 */
function safeHref(href: string): string {
  if (!href.includes("[id]")) return href;
  if (href.startsWith("/dashboard/students")) return "/dashboard/students";
  if (href.startsWith("/dashboard/staff")) return "/dashboard/staff";
  return "/dashboard";
}

function AnswerBody({ answer }: { answer: ChatAnswer }) {
  return (
    <>
      {(answer.steps ?? []).length > 0 && (
        <ol className="mt-2.5 space-y-1.5">
          {(answer.steps ?? []).map((step, index) => (
            <li
              key={index}
              className="flex gap-2 text-[13px] leading-snug text-slate-700"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10.5px] font-bold text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {(answer.tips ?? []).length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {(answer.tips ?? []).map((tip, index) => (
            <div
              key={index}
              className="flex gap-2 text-[13px] leading-snug text-slate-600"
            >
              <Sparkles size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span>{tip}</span>
            </div>
          ))}
        </div>
      )}

      {(() => {
        const target = answer.href ? safeHref(answer.href) : null;
        return target ? (
          <Link
            href={target}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-[13px] font-bold text-blue-700 transition hover:bg-blue-100"
          >
            Open: {answer.pageLabel ?? target}
          </Link>
        ) : null;
      })()}

      {(answer.related ?? []).length > 0 && (
        <div className="mt-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
            Related pages
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(answer.related ?? []).map((link) => (
              <Link
                key={link.href}
                href={safeHref(link.href)}
                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function EduNexaChat() {
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(
    DEFAULT_SUGGESTIONS,
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages, typing, open]);

  function toggleOpen() {
    const willOpen = !open;
    setOpen(willOpen);

    if (willOpen && messages.length === 0) {
      setMessages([
        {
          id: newId(),
          role: "bot",
          text: WELCOME_ANSWER.text,
          answer: WELCOME_ANSWER,
        },
      ]);
    }
    if (willOpen) {
      setSuggestions(
        pathname ? suggestionsForPage(pathname) : DEFAULT_SUGGESTIONS,
      );
    }
  }

  async function send(questionText: string | null) {
    const question = (questionText ?? input).trim();
    if (!question || typing) return;

    setInput("");
    setTyping(true);
    setSuggestions([]);

    setMessages((current) => [
      ...current,
      { id: newId(), role: "user", text: question },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, page: pathname }),
      });

      const data = (await response.json()) as {
        answer?: ChatAnswer;
        suggestions?: string[];
      };

      if (!response.ok || !data.answer) {
        throw new Error("Assistant request failed.");
      }

      const answer = data.answer;

      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "bot",
          text: answer.text,
          answer,
        },
      ]);

      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSuggestions(data.suggestions.slice(0, 3));
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "bot",
          text: "Sorry, I couldn't reach the assistant just now. Please try again in a moment.",
        },
      ]);
    } finally {
      setTyping(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(null);
  }

  return (
    <>
      {/* ROUND FLOATING BUTTON */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={open ? "Close EduNexa assistant" : "Open EduNexa assistant"}
        title="Need help? Ask EduNexa Assistant"
        className="fixed bottom-24 right-5 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl ring-2 ring-white/80 transition hover:scale-105 hover:bg-blue-800 md:bottom-6"
      >
        {open ? (
          <X size={26} strokeWidth={2.5} />
        ) : (
          <MessagesSquare size={26} strokeWidth={2.5} />
        )}
        {!open && (
          <span className="absolute right-0 top-0 flex h-3 w-3">
            <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400 ring-2 ring-white" />
          </span>
        )}
      </button>

      {/* CHAT PANEL */}
      {open && (
        <section
          aria-label="EduNexa Assistant chat"
          className="fixed bottom-24 right-4 z-[90] flex h-[min(38rem,calc(100vh-9rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl md:bottom-6"
        >
          {/* Header */}
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/60">
                <Bot size={22} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">EduNexa Assistant</p>
                <p className="flex items-center gap-1.5 text-[11px] text-blue-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Online • Knows every page
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleOpen}
              aria-label="Close chat"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
          </header>

          {/* Messages */}
          <div
            ref={scrollerRef}
            className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 px-3.5 py-3"
          >
            {messages.map((message) =>
              message.role === "user"
                ? <UserBubble key={message.id} text={message.text} />
                : <BotBubble key={message.id} message={message} />,
            )}

            {typing && (
              <div className="flex items-end gap-2">
                <BotAvatar />
                <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                  <span className="flex gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="border-t border-slate-200 bg-white px-3 py-2.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                Try asking
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask EduNexa Assistant…"
              autoComplete="off"
              className="w-full flex-1 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={!input.trim() || typing}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Send size={19} strokeWidth={2.5} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}