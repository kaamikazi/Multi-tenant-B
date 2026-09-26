import type { Metadata } from "next";
import Link from "next/link";
import { deleteThread } from "./actions";
import { Chat, type ChatMessage } from "./chat";
import { Card, PageHeader } from "@/components/ui";
import { assistantConfigured } from "@/lib/assistant/agent";
import { toolDeclarations, toolLabel } from "@/lib/assistant/tools";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Assistant · TenantFlow" };

const SUGGESTIONS = {
  manager: [
    "Who are my hottest leads?",
    "Give me an overview of this workspace",
    "Who is on the team and what are their roles?",
    "Are there any pending invitations?",
    "When does our subscription renew?",
  ],
  member: [
    "Which of my leads should I follow up first?",
    "Give me an overview of this workspace",
    "Who are the admins here?",
    "Can you show me our billing status?",
  ],
};

export default async function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  const member = await requireMember();
  const { thread } = await searchParams;
  const threadId = typeof thread === "string" ? thread : null;

  const supabase = await createClient();
  const [{ data: threads }, { data: usage }, { data: rows }] = await Promise.all([
    supabase.from("chat_threads").select("id, title").order("updated_at", { ascending: false }).limit(30),
    supabase.rpc("get_ai_usage").maybeSingle(),
    threadId
      ? supabase.from("chat_messages").select("id, role, content, tools_used").eq("thread_id", threadId).order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const messages: ChatMessage[] = (rows ?? []).map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    tools: m.tools_used,
  }));

  const outOfMessages = usage?.message_limit != null && usage.used >= usage.message_limit;
  const disabledReason = !assistantConfigured
    ? "Demo: the assistant needs a GEMINI_API_KEY on the server."
    : outOfMessages
      ? `This workspace has used all ${usage.message_limit} AI messages for this month. Upgrade to Pro for more.`
      : null;

  return (
    <>
      <PageHeader
        title="Assistant"
        description={
          <>
            Answers from {member.tenant.name}&apos;s data only, limited to what your role can see.
            {usage && (
              <span className="ml-1">
                {usage.message_limit == null
                  ? `${usage.used} messages this month.`
                  : `${usage.used} of ${usage.message_limit} messages used this month.`}
              </span>
            )}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Conversations" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1">
          <Link
            href="/assistant"
            className={`rounded-md px-3 py-2 text-sm font-medium ${!threadId ? "bg-surface" : "text-accent hover:bg-surface"}`}
          >
            + New conversation
          </Link>
          {threads?.map((t) => (
            <div key={t.id} className={`group flex items-center rounded-md ${t.id === threadId ? "bg-surface" : "hover:bg-surface"}`}>
              <Link
                href={`/assistant?thread=${t.id}`}
                className="min-w-0 flex-1 truncate px-3 py-2 text-sm"
                aria-current={t.id === threadId ? "page" : undefined}
              >
                {t.title}
              </Link>
              <form action={deleteThread}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  aria-label={`Delete conversation ${t.title}`}
                  className="px-2 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100"
                >
                  ×
                </button>
              </form>
            </div>
          ))}
        </nav>

        <Card className="flex overflow-hidden">
          <Chat
            key={threadId ?? "new"}
            threadId={threadId}
            initialMessages={messages}
            suggestions={member.role === "member" ? SUGGESTIONS.member : SUGGESTIONS.manager}
            disabledReason={disabledReason}
            toolLabels={Object.fromEntries(toolDeclarations.map((d) => [d.name!, toolLabel(d.name!)]))}
          />
        </Card>
      </div>
    </>
  );
}
