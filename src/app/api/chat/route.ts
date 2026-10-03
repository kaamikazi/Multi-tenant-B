import { NextResponse, type NextRequest } from "next/server";
import { assistantConfigured, isOverloaded, runAssistant } from "@/lib/assistant/agent";
import { BUDGET } from "@/lib/assistant/limits";
import { getMember } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ChatEvent =
  | { type: "thread"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "done" }
  | { type: "error"; message: string };

const MAX_MESSAGE_LENGTH = 4000; // also enforced by a CHECK constraint on user messages
const HISTORY_FETCH = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Message provenance: the user's question is written with the user's own
// client (RLS + the quota/budget trigger apply). The assistant's reply is
// written only through record_assistant_message(), which is executable by
// service_role alone, so a user can't forge model history. The admin client
// is used for that single write, after this handler has verified the session
// and that the conversation is the caller's own.
async function recordReply(threadId: string, userId: string, content: string, tools: string[], tokens: number | null) {
  const { error } = await createAdminClient().rpc("record_assistant_message", {
    p_thread: threadId,
    p_user: userId,
    p_content: content,
    p_tools: tools,
    p_tokens: tokens ?? undefined,
  });
  if (error) console.error("could not record assistant reply", error.code);
}

export async function POST(request: NextRequest) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  if (!assistantConfigured) return NextResponse.json({ error: "The assistant isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { threadId?: unknown; message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
  }
  // null or absent means "start a new conversation" (what the client sends).
  if (body.threadId != null && (typeof body.threadId !== "string" || !UUID.test(body.threadId))) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  // Everything below runs as the user: RLS limits it to their own conversations.
  const supabase = await createClient();

  let threadId = typeof body.threadId === "string" ? body.threadId : null;
  if (threadId) {
    const { data } = await supabase.from("chat_threads").select("id").eq("id", threadId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  } else {
    const title = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    const { data, error } = await supabase.from("chat_threads").insert({ title }).select("id").single();
    if (error) return NextResponse.json({ error: "Could not start a conversation." }, { status: 500 });
    threadId = data.id;
  }

  const { data: previous } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_FETCH);

  // Saving the question spends the allowance and takes the generation lease;
  // the database refuses it when a quota or budget is exceeded.
  const { error: questionError } = await supabase.from("chat_messages").insert({ thread_id: threadId, content: message });
  if (questionError) {
    const status = questionError.code === "54000" ? 429 : questionError.code === "42501" ? 403 : 500;
    const text = status === 500 ? "Could not send your message." : questionError.message;
    return NextResponse.json({ error: status === 429 && /month/.test(text) ? `${text} Upgrade to Pro for more.` : text }, { status });
  }

  const history = (previous ?? []).reverse().map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  // One signal for "stop": the client went away, or the request ran too long.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(BUDGET.requestTimeoutMs)]);
  const conversation = threadId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Only a disconnected client stops output; on a timeout the user still
      // needs to see the "took too long" message.
      const send = (event: ChatEvent) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // stream already closed
        }
      };
      send({ type: "thread", id: conversation });

      let answer = "";
      let tokens: number | null = null;
      const toolsUsed = new Set<string>();
      try {
        for await (const event of runAssistant({ supabase, member, history, message, signal })) {
          if (event.type === "text") {
            answer += event.delta;
            send(event);
          } else if (event.type === "tool") {
            toolsUsed.add(event.name);
            send(event);
          } else {
            tokens = event.tokens;
          }
        }
        await recordReply(conversation, member.id, answer, [...toolsUsed], tokens);
        send({ type: "done" });
      } catch (e) {
        const timedOut = signal.aborted && !request.signal.aborted;
        const cancelled = request.signal.aborted;
        const note = cancelled
          ? "The answer was cancelled."
          : timedOut
            ? "The answer took too long and was stopped. Please try again."
            : isOverloaded(e)
              ? "The AI service is busy right now. Please try again in a moment."
              : "The assistant ran into a problem. Please try again.";
        if (!cancelled) console.error("assistant error", e instanceof Error ? e.message : e);
        // Always record something: keeps the conversation coherent and
        // releases the generation lease for this thread.
        await recordReply(conversation, member.id, `${answer.trim() ? `${answer.trim()}\n\n` : ""}_${note}_`, [...toolsUsed], tokens);
        send({ type: "error", message: note });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed because the client disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
