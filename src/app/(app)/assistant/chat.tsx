"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/app/api/chat/route";
import { Markdown } from "./markdown";
import { Button } from "@/components/ui";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; tools: string[] };

type Props = {
  threadId: string | null;
  initialMessages: ChatMessage[];
  suggestions: string[];
  disabledReason: string | null;
  toolLabels: Record<string, string>;
};

export function Chat({ threadId, initialMessages, suggestions, disabledReason, toolLabels }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput("");

    const replyId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: message, tools: [] },
      { id: replyId, role: "assistant", content: "", tools: [] },
    ]);
    const updateReply = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((all) => all.map((m) => (m.id === replyId ? fn(m) : m)));

    let newThreadId = threadId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong.");
      }

      // Newline-delimited JSON events: thread, tool, text…, done | error.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "thread") newThreadId = event.id;
          else if (event.type === "text") updateReply((m) => ({ ...m, content: m.content + event.delta }));
          else if (event.type === "tool") updateReply((m) => ({ ...m, tools: [...m.tools, event.name] }));
          else if (event.type === "error") throw new Error(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setMessages((all) => all.filter((m) => m.id !== replyId || m.content));
    } finally {
      setBusy(false);
      if (newThreadId && newThreadId !== threadId) router.replace(`/assistant?thread=${newThreadId}`);
      router.refresh(); // usage meter + conversation list
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {messages.length === 0 && (
          <div className="grid gap-4 py-6 text-center">
            <p className="text-sm text-muted">
              Ask about your workspace. The assistant can only see what your role can see.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={Boolean(disabledReason) || busy}
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-accent-foreground">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%] text-sm">
              {m.tools.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {[...new Set(m.tools)].map((t) => (
                    <span key={t} className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                      Looked up {toolLabels[t] ?? t}
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-2.5">
                {m.content ? <Markdown>{m.content}</Markdown> : <TypingDots />}
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <form
        className="border-t border-line p-3 sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
        {disabledReason && <p className="mb-2 text-sm text-muted">{disabledReason}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <textarea
            id="chat-input"
            rows={1}
            value={input}
            maxLength={4000}
            disabled={Boolean(disabledReason)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your leads, team or billing…"
            className="max-h-40 min-h-10 flex-1 resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          />
          <Button type="submit" disabled={busy || !input.trim() || Boolean(disabledReason)}>
            {busy ? "Thinking…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Assistant is typing">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
