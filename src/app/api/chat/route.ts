import { NextResponse, type NextRequest } from "next/server";
import { assistantConfigured, isOverloaded, runAssistant } from "@/lib/assistant/agent";
import { getMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ChatEvent =
  | { type: "thread"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "done" }
  | { type: "error"; message: string };

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_LIMIT = 20;

export async function POST(request: NextRequest) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  if (!assistantConfigured) return NextResponse.json({ error: "The assistant isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { threadId?: unknown; message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
  }

  // Everything below runs as the user: RLS limits it to their own conversations.
  const supabase = await createClient();

  let threadId = typeof body.threadId === "string" ? body.threadId : null;
  let threadTitle: string;
  if (threadId) {
    const { data } = await supabase.from("chat_threads").select("id, title").eq("id", threadId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    threadTitle = data.title;
  } else {
    threadTitle = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    const { data, error } = await supabase.from("chat_threads").insert({ title: threadTitle }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    threadId = data.id;
  }

  const { data: previous } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Saving the question is what spends the allowance (enforced by the database).
  const { error: quotaError } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, role: "user", content: message });
  if (quotaError) {
    const limited = quotaError.code === "54000";
    return NextResponse.json(
      { error: limited ? `${quotaError.message} Upgrade to Pro for more.` : quotaError.message },
      { status: limited ? 429 : 500 },
    );
  }

  const history = (previous ?? []).reverse().map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "thread", id: threadId });

      let answer = "";
      const toolsUsed = new Set<string>();
      try {
        for await (const event of runAssistant({ supabase, member, history, message })) {
          if (event.type === "text") answer += event.delta;
          else toolsUsed.add(event.name);
          send(event);
        }
        await supabase.from("chat_messages").insert({
          thread_id: threadId,
          role: "assistant",
          content: answer.trim() || "I don't have an answer for that.",
          tools_used: [...toolsUsed],
        });
        // Bumps updated_at so the conversation moves to the top of the list.
        await supabase.from("chat_threads").update({ title: threadTitle }).eq("id", threadId);
        send({ type: "done" });
      } catch (e) {
        console.error("assistant error", e);
        const message = isOverloaded(e)
          ? "The AI service is busy right now. Please try again in a moment."
          : "The assistant ran into a problem. Please try again.";
        // Saved so the conversation still reads sensibly after a reload.
        await supabase.from("chat_messages").insert({
          thread_id: threadId,
          role: "assistant",
          content: `${answer.trim() ? `${answer.trim()}\n\n` : ""}_${message}_`,
          tools_used: [...toolsUsed],
        });
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
