"use client";
// Development-only visual check for the Inbox, with sample data:
// `?scene=empty` (nothing set up yet) and `?scene=quick-reply` (the quick
// reply form open). Nothing is sent: buttons call the server only on a click.
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import type { EngageHome, EngageRule } from "@/lib/engage/contracts";
import { RULE_TEMPLATES, type RuleInput } from "@/lib/engage/rules";
import { InboxScreen } from "./InboxScreen";
const WS = "00000000-0000-4000-8000-000000000000";
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;

function sample(now: number): EngageHome {
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  const rule = (n: number, over: Partial<EngageRule>): EngageRule => ({
    id: id(n),
    name: "Rule",
    status: "live",
    platforms: ["instagram", "facebook"],
    postScope: "any",
    postIds: [],
    match: "keywords",
    keywords: [],
    wholeWord: true,
    replyMode: "fixed",
    replies: [],
    moxGuidance: null,
    dmEnabled: false,
    dmMessage: null,
    dmLink: null,
    sendMode: "auto",
    position: n,
    liveSince: at(60 * 24 * 7),
    matchedCount: 0,
    sentCount: 0,
    dmCount: 0,
    lastMatchedAt: null,
    ...over,
  });
  const base = {
    kind: "comment" as const,
    platform: "instagram" as const,
    pageName: "Chai Corner",
    igUsername: "chaicorner.pk",
    postId: "1",
    postCaption: "New: cardamom cold brew, only this week ☕",
    postPermalink: null,
    draft: null,
    replyText: null,
    repliedAt: null,
    lastError: null,
    ruleId: null,
    ruleName: null,
    matchedKeyword: null,
    autoSent: false,
    dmStatus: "none" as const,
    dmText: null,
    dmError: null,
    moxState: "none" as const,
    moxNote: null,
    questionId: null,
  };
  return {
    configured: true,
    connection: {
      status: "active",
      accountName: "Chai Corner",
      lastError: null,
      canMessage: { instagram: true, facebook: true },
    },
    pages: [
      {
        id: id(90),
        pageName: "Chai Corner",
        igUsername: "chaicorner.pk",
        hasInstagram: true,
        syncedAt: at(2),
        lastError: null,
      },
    ],
    comments: [
      {
        ...base,
        id: id(10),
        kind: "dm",
        authorName: "Hina",
        body: "Hi! Do you take orders for an office of 20 people? We're in Gulberg.",
        commentedAt: at(2),
        postCaption: null,
        status: "drafted",
        draft: "Hi Hina! Yes, we do office orders. Which day and time works for you?",
        moxState: "needs_person",
        moxNote: "A bulk order: a person should confirm it.",
      },
      {
        ...base,
        id: id(11),
        authorName: "sara.khan",
        body: "Is the 1 litre bottle back in stock?",
        commentedAt: at(4),
        status: "new",
        moxState: "waiting_info",
        moxNote: "When is the 1 litre cold brew back in stock?",
        questionId: id(41),
      },
      {
        ...base,
        id: id(12),
        authorName: "ali_raza",
        commentedAt: at(18),
        status: "drafted",
        draft: "So sorry Ali! Send us your order number in a message and we'll sort it today.",
        body: "My order came late and the cup was cracked 😞",
        moxState: "needs_person",
        moxNote: "A complaint about an order.",
      },
      {
        ...base,
        id: id(14),
        authorName: "zainab.eats",
        body: "Price kya hai? 😍",
        commentedAt: at(9),
        status: "replied",
        replyText: "Rs 650 for 350 ml and Rs 950 for 500 ml, Zainab! 😍",
        repliedAt: at(8),
        autoSent: true,
        moxState: "replied",
      },
      {
        ...base,
        id: id(13),
        platform: "facebook",
        authorName: "Hina Malik",
        body: "LINK please 🔥",
        commentedAt: at(35),
        status: "replied",
        replyText: "Sent it to your messages, Hina!",
        repliedAt: at(33),
        autoSent: true,
        ruleId: id(1),
        ruleName: "Link by DM",
        matchedKeyword: "link",
        dmStatus: "sent",
        dmText: "Hi Hina! Here's the link you asked for:\n\nhttps://chaicorner.pk/menu",
      },
    ],
    counts: { waiting: 2, replied: 41, autoReplied: 34 },
    automationsOn: true,
    autoReply: true,
    guidelines:
      "Reply in Roman Urdu when they write in Urdu\nNever promise a delivery date\nKeep it to one or two short lines",
    questions: [
      {
        id: id(41),
        question: "When is the 1 litre cold brew back in stock?",
        askedCount: 3,
        exampleComment: "Is the 1 litre bottle back in stock?",
        createdAt: at(30),
      },
    ],
    rules: [
      rule(1, {
        name: "Link by DM",
        keywords: ["link", "info", "menu"],
        replies: ["Sent it to your messages, {name}!", "Check your DMs {name}, it's there!"],
        dmEnabled: true,
        dmMessage: "Hi {name}! Here's the link you asked for:",
        dmLink: "https://chaicorner.pk/menu",
        matchedCount: 31,
        sentCount: 27,
        dmCount: 26,
      }),
      rule(2, {
        name: "Price questions",
        keywords: ["price", "cost", "how much", "qeemat"],
        replyMode: "mox",
        moxGuidance: "Answer from the price list. If unsure, invite them to DM us.",
        sendMode: "approve",
        matchedCount: 12,
        sentCount: 9,
      }),
      rule(3, {
        name: "Thank you",
        status: "paused",
        postScope: "posts",
        postIds: ["1", "2"],
        match: "any",
        replies: ["Thank you {name}!", "So glad you like it, {name}!"],
        matchedCount: 54,
        sentCount: 54,
      }),
    ],
    answers: [
      {
        id: id(21),
        question: "Do you deliver to Lahore?",
        answer: "Yes, everywhere in Lahore in 2–3 working days. Free over Rs 3,000.",
        updatedAt: at(600),
      },
      {
        id: id(22),
        question: "What is the price of the cold brew?",
        answer: "Rs 650 for 350 ml, Rs 950 for 500 ml.",
        updatedAt: at(900),
      },
      {
        id: id(23),
        question: "Opening hours?",
        answer: "Every day, 9 am to midnight. Fridays from 2 pm.",
        updatedAt: at(1500),
      },
    ],
    examples: [
      {
        id: id(31),
        platform: "instagram",
        comment: "Is it too sweet?",
        reply: "Not at all! We keep it lightly sweet, and you can ask for no sugar.",
        createdAt: at(300),
      },
      {
        id: id(32),
        platform: "facebook",
        comment: "Do you have a branch in Gulberg?",
        reply: "Not yet, but we deliver to Gulberg every day! Send us a message to order.",
        createdAt: at(2000),
      },
    ],
  };
}

export function EngageLab() {
  const params = useSearchParams();
  const scene = params.get("scene");
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const data = useMemo(() => {
    const full = sample(Date.now());
    if (scene === "setup")
      // What a brand sees when Meta shared no Instagram and no messages.
      return {
        ...full,
        connection: { ...full.connection!, canMessage: { instagram: false, facebook: false } },
        pages: full.pages.map((p) => ({ ...p, hasInstagram: false, igUsername: null })),
      };
    return scene === "empty"
      ? {
          ...full,
          rules: [],
          answers: [],
          examples: [],
          questions: [],
          guidelines: "",
          counts: { waiting: 0, replied: 0, autoReplied: 0 },
          comments: [],
        }
      : full;
  }, [scene]);
  const template = RULE_TEMPLATES[0].rule;
  const quick: RuleInput | undefined =
    scene === "quick-reply"
      ? {
          name: "Link by DM",
          platforms: ["instagram", "facebook"],
          postScope: "any",
          postIds: [],
          match: "keywords",
          keywords: template.keywords ?? [],
          wholeWord: true,
          replyMode: "fixed",
          replies: template.replies ?? [],
          moxGuidance: null,
          dmEnabled: true,
          dmMessage: template.dmMessage ?? null,
          dmLink: "https://chaicorner.pk/menu",
          sendMode: "auto",
        }
      : undefined;
  const noop = () => {};
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-[var(--ds-canvas-bg,#f6f6f4)] p-4">
        <div className="mx-auto max-w-[1180px] rounded-[28px] border bg-background shadow-sm">
          <SurfacePage width="wide">
            <InboxScreen
              key={scene ?? "home"}
              workspaceId={WS}
              data={data}
              canEdit
              syncing={false}
              waiting={false}
              onSync={noop}
              onConnect={noop}
              onDisconnect={noop}
              onChanged={noop}
              initialRule={quick ? { input: quick } : undefined}
            />
          </SurfacePage>
        </div>
      </div>
    </QueryClientProvider>
  );
}
