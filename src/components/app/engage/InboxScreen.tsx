"use client";
// InboxScreen — the Inbox on one page, Communities / Autopilot style:
//   * a header with the accounts, Refresh and the Auto-reply switch;
//   * "Mox needs to know": what Mox couldn't answer, one line to answer each
//     (kept for every later reply, and the waiting comments are answered);
//   * four numbers (answered by itself, needs you, answered, answers known);
//   * the comments, each with a reply a person can still edit and send;
//   * on the right, "How Mox replies" (the team's rules), "What people ask"
//     (answers, editable), "Quick replies" (keyword → reply / link by DM).
// Mox replies by itself in the background (auto-reply.server.ts); this page
// shows it and takes the team's answers.
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import {
  dsFocus,
  dsGhostBtn,
  dsIconBtn,
  dsInkBtn,
  dsPrimaryBtn,
} from "@/components/app/surface/buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Brain,
  Check,
  Inbox,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash,
  X,
  Zap,
} from "@/components/icons";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  deleteEngageAnswer,
  deleteEngageExample,
  deleteEngageRule,
  dismissEngageComment,
  draftEngageReply,
  saveEngageAnswer,
  saveEngageRule,
  sendEngageDm,
  sendEngageReply,
  setEngageAutomations,
  setEngageAutoReply,
  saveEngageGuidelines,
  answerEngageQuestion,
  dismissEngageQuestion,
  type EngageQuestion,
  setEngageRuleStatus,
  type EngageAnswer,
  type EngageComment,
  type EngageHome,
  type EngageRule,
} from "@/lib/engage.functions";
import { MAX_REPLY_CHARS } from "@/lib/engage/reply";
import { MAX_GUIDELINES } from "@/lib/engage/auto-reply";
import { PLATFORM_LABEL } from "@/lib/engage/contracts";
import { MAX_ANSWERS, tidyAnswer } from "@/lib/engage/training";
import {
  MAX_KEYWORDS,
  MAX_RULES,
  RULE_TEMPLATES,
  tidyRule,
  type RuleInput,
} from "@/lib/engage/rules";
import { Chip, ago, errorText } from "./engage-shared";

type Filter = "waiting" | "answered";

export type InboxScreenProps = {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  syncing: boolean;
  waiting: boolean;
  onSync: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onChanged: () => void;
  /** Open a quick reply's form straight away (the lab uses it). */
  initialRule?: { id?: string; input: RuleInput };
};

export function InboxScreen(props: InboxScreenProps) {
  const { data, canEdit, workspaceId } = props;
  const conn = data.connection!;
  const [filter, setFilter] = useState<Filter>("waiting");
  // The answer form: new, an edit, or a comment turned into an answer.
  const [teaching, setTeaching] = useState<AnswerDraft | null>(null);
  const [ruleForm, setRuleForm] = useState<{ id?: string; input: RuleInput } | null>(
    props.initialRule ?? null,
  );

  const shown = useMemo(
    () =>
      data.comments.filter((c) =>
        filter === "waiting" ? c.status !== "replied" : c.status === "replied",
      ),
    [data.comments, filter],
  );
  const liveRules = data.rules.filter((r) => r.status === "live").length;
  const working = data.autoReply || (liveRules > 0 && data.automationsOn);

  const autoReply = useMutation({
    mutationFn: (on: boolean) => setEngageAutoReply({ data: { workspaceId, on } }),
    onSuccess: (_r, on) => {
      toast.success(on ? "Mox answers new comments by itself" : "Auto-reply is off");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't change that.")),
  });

  const toggleAll = useMutation({
    mutationFn: (on: boolean) => setEngageAutomations({ data: { workspaceId, on } }),
    onSuccess: (_r, on) => {
      toast.success(on ? "Quick replies are on" : "Quick replies are paused");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't change that.")),
  });

  const handle = conn.accountName;
  const igNames = data.pages.map((p) => p.igUsername).filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-5" data-testid="inbox-screen">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5" aria-hidden>
              <PlatformAppIcon platform="instagram" size={22} />
              <PlatformAppIcon platform="facebook" size={22} />
            </div>
            <h2 className="text-[17px] font-semibold tracking-tight">Inbox</h2>
          </div>
          <p className="max-w-[560px] text-[13px] text-muted-foreground">
            Comments on {handle}
            {igNames.length ? ` and @${igNames[0]}` : ""}.{" "}
            {data.autoReply
              ? "Mox answers them by itself and asks you only what it doesn't know."
              : "Turn on Auto-reply and Mox answers them by itself."}
          </p>
          {conn.lastError ? (
            <p className="text-[12.5px] text-destructive">{conn.lastError}</p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              {data.pages[0]?.syncedAt ? `Checked ${ago(data.pages[0].syncedAt)}` : "Not read yet"}
              {working ? " · new comments are read every few minutes" : ""}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label
              className={cn(
                dsGhostBtn,
                "h-9 cursor-pointer gap-2 px-3.5 text-[13px]",
                autoReply.isPending && "opacity-60",
              )}
              data-testid="inbox-auto-reply"
            >
              <Switch
                checked={data.autoReply}
                disabled={autoReply.isPending}
                onCheckedChange={(on) => autoReply.mutate(on)}
                aria-label="Auto-reply"
              />
              Auto-reply {data.autoReply ? "on" : "off"}
            </label>
            {conn.status !== "active" ? (
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                onClick={props.onConnect}
                disabled={props.waiting}
              >
                {props.waiting ? "Waiting for Meta…" : "Reconnect"}
              </button>
            ) : (
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                onClick={props.onSync}
                disabled={props.syncing}
              >
                <RefreshCw className={cn("h-4 w-4", props.syncing && "animate-spin")} />
                {props.syncing ? "Reading…" : "Refresh"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── what Mox needs to know ── */}
      {data.questions.length > 0 && (
        <QuestionsTile
          workspaceId={workspaceId}
          questions={data.questions}
          canEdit={canEdit}
          onChanged={props.onChanged}
        />
      )}

      {/* ── the numbers ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="inbox-stats">
        <Stat
          label="Answered by itself"
          value={data.counts.autoReplied}
          onClick={() => setFilter("answered")}
        />
        <Stat
          label="Needs you"
          value={data.counts.waiting}
          tone={data.counts.waiting ? "warn" : undefined}
          onClick={() => setFilter("waiting")}
        />
        <Stat label="Answered in all" value={data.counts.replied} />
        <Stat label="Answers Mox knows" value={data.answers.length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── comments ── */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            {(
              [
                ["waiting", `Needs you · ${data.counts.waiting}`],
                ["answered", "Answered"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  "h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                  dsFocus,
                  filter === id
                    ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="ds-tile">
              <EmptyState
                size="sm"
                icon={Inbox}
                title={filter === "waiting" ? "You're all caught up" : "Nothing answered yet"}
                description={
                  filter === "waiting"
                    ? data.autoReply
                      ? "Mox is answering new comments. Only what needs you shows here."
                      : "New comments show here. Turn on Auto-reply and Mox answers them by itself."
                    : "Replies Mox and you sent show here."
                }
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  workspaceId={workspaceId}
                  canEdit={canEdit}
                  onChanged={props.onChanged}
                  onTeach={(q, a) => setTeaching({ question: q, answer: a })}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ── the side: what Mox knows, quick replies, the account ── */}
        <div className="space-y-4">
          <GuidelinesTile
            workspaceId={workspaceId}
            guidelines={data.guidelines}
            canEdit={canEdit}
            onChanged={props.onChanged}
          />
          <AnswersTile
            workspaceId={workspaceId}
            data={data}
            canEdit={canEdit}
            teaching={teaching}
            setTeaching={setTeaching}
            onChanged={props.onChanged}
          />
          <QuickRepliesTile
            workspaceId={workspaceId}
            data={data}
            canEdit={canEdit}
            onToggleAll={(on) => toggleAll.mutate(on)}
            toggling={toggleAll.isPending}
            onOpen={setRuleForm}
            onChanged={props.onChanged}
          />
          <AccountTile {...props} />
        </div>
      </div>

      {ruleForm && (
        <QuickReplyDialog
          workspaceId={workspaceId}
          data={data}
          id={ruleForm.id}
          initial={ruleForm.input}
          onClose={() => setRuleForm(null)}
          onSaved={() => {
            setRuleForm(null);
            props.onChanged();
          }}
          onReconnect={props.onConnect}
        />
      )}
    </div>
  );
}

function Stat(props: { label: string; value: number; tone?: "warn"; onClick?: () => void }) {
  const body = (
    <>
      <p className="ds-label">{props.label}</p>
      <p
        className={cn(
          "mt-1 text-[24px] font-semibold tabular-nums tracking-tight",
          props.tone === "warn" && "text-warning",
        )}
      >
        {props.value.toLocaleString()}
      </p>
    </>
  );
  return props.onClick ? (
    <button
      type="button"
      onClick={props.onClick}
      className={cn("ds-tile ds-tile-hover p-4 text-left", dsFocus)}
    >
      {body}
    </button>
  ) : (
    <div className="ds-tile p-4">{body}</div>
  );
}

/* ───────────────────────── what Mox needs to know ───────────────────────── */

function QuestionsTile(props: {
  workspaceId: string;
  questions: EngageQuestion[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const n = props.questions.length;
  return (
    <div className="ds-tile space-y-3 p-4 ring-1 ring-primary/25" data-testid="inbox-questions">
      <div className="flex items-start gap-3">
        <span className="ds-grad-pill grid size-9 shrink-0 place-items-center rounded-full text-[var(--mox-ink)]">
          <Brain className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">
            Mox needs to know {n === 1 ? "one thing" : `${n} things`}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            Answer once. Mox keeps it, replies to everyone who asked, and uses it from now on. You
            can also just tell Mox in chat.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {props.questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            workspaceId={props.workspaceId}
            canEdit={props.canEdit}
            onChanged={props.onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function QuestionRow(props: {
  question: EngageQuestion;
  workspaceId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const q = props.question;
  const [answer, setAnswer] = useState("");
  const ids = { workspaceId: props.workspaceId, questionId: q.id };
  const save = useMutation({
    mutationFn: () => answerEngageQuestion({ data: { ...ids, answer: answer.trim() } }),
    onSuccess: () => {
      toast.success("Mox learned it and is answering the comments that waited");
      setAnswer("");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't save the answer.")),
  });
  const skip = useMutation({
    mutationFn: () => dismissEngageQuestion({ data: ids }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't skip it.")),
  });
  return (
    <li className="rounded-2xl bg-[var(--ds-well-bg)] px-3.5 py-3">
      <p className="text-[13.5px] font-semibold leading-snug">{q.question}</p>
      <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
        {q.askedCount > 1 ? `${q.askedCount} people asked` : "Asked"}
        {q.exampleComment ? ` · “${q.exampleComment}”` : ""}
      </p>
      {props.canEdit && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) save.mutate();
          }}
        >
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer"
            maxLength={1_500}
            className="h-9 flex-1 rounded-full bg-card text-[13px]"
            aria-label={`Answer: ${q.question}`}
          />
          <button
            type="submit"
            className={cn(dsPrimaryBtn, "h-9 shrink-0 px-4 text-[13px]")}
            disabled={!answer.trim() || save.isPending}
          >
            <Check className="size-4" />
            {save.isPending ? "Saving…" : "Teach"}
          </button>
          <button
            type="button"
            className={cn(dsIconBtn, "shrink-0")}
            aria-label="Skip this question"
            title="Skip: these comments wait for you instead"
            onClick={() => skip.mutate()}
            disabled={skip.isPending}
          >
            <X className="size-4" />
          </button>
        </form>
      )}
    </li>
  );
}

/* ───────────────────────── how Mox replies ───────────────────────── */

const GUIDELINES_HINT =
  "One rule per line, e.g.\nReply in Roman Urdu when they write in Urdu\nNever promise a delivery date\nSend price questions to DM";

function GuidelinesTile(props: {
  workspaceId: string;
  guidelines: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.guidelines);
  useEffect(() => setText(props.guidelines), [props.guidelines]);
  const save = useMutation({
    mutationFn: () =>
      saveEngageGuidelines({ data: { workspaceId: props.workspaceId, guidelines: text } }),
    onSuccess: () => {
      toast.success("Mox follows these from now on");
      setEditing(false);
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't save them.")),
  });
  const lines = props.guidelines.split("\n").filter(Boolean);
  return (
    <div className="ds-tile space-y-3 p-4" data-testid="inbox-guidelines">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="ds-label">How Mox replies</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Your rules for every reply. Tell Mox in chat and they land here.
          </p>
        </div>
        {props.canEdit && !editing && (
          <button
            type="button"
            className={cn(dsIconBtn, "shrink-0")}
            aria-label="Edit how Mox replies"
            title="Edit"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={GUIDELINES_HINT}
            rows={5}
            maxLength={MAX_GUIDELINES}
            className="rounded-2xl text-[13px]"
            aria-label="How Mox replies"
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
              onClick={() => {
                setText(props.guidelines);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12px]")}
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              <Check className="size-3.5" />
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : lines.length ? (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l} className="flex gap-2 text-[12.5px] leading-snug">
              <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-primary" />
              {l}
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          disabled={!props.canEdit}
          onClick={() => setEditing(true)}
          className={cn(
            "w-full rounded-2xl border border-dashed px-3.5 py-3 text-left text-[12.5px] text-muted-foreground hover:text-foreground",
            dsFocus,
          )}
        >
          Add how you like replies: language, tone, what never to promise.
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── a comment ───────────────────────── */

const MOX_CHIP: Record<EngageComment["moxState"], string> = {
  none: "",
  replied: "",
  waiting_info: "Waiting for your answer",
  needs_person: "Needs you",
  skipped: "Mox skipped it",
};

const DM_LABEL: Record<EngageComment["dmStatus"], string> = {
  none: "",
  pending: "DM waits for Send",
  sent: "DM sent",
  failed: "DM failed",
  skipped: "DM skipped",
  unknown: "DM not confirmed",
};

function CommentCard(props: {
  comment: EngageComment;
  workspaceId: string;
  canEdit: boolean;
  onChanged: () => void;
  onTeach: (question: string, answer: string) => void;
}) {
  const c = props.comment;
  const [text, setText] = useState(c.draft ?? "");
  useEffect(() => setText(c.draft ?? ""), [c.draft]);
  const done = c.status === "replied";
  const limit = MAX_REPLY_CHARS[c.platform];
  const ids = { workspaceId: props.workspaceId, commentId: c.id };

  const draft = useMutation({
    mutationFn: () => draftEngageReply({ data: ids }),
    onSuccess: (d) => {
      setText(d.text);
      if (d.removed) toast("Mox left out a line with a figure your brand never gave.");
    },
    onError: (e) => toast.error(errorText(e, "Mox couldn't write a draft.")),
  });
  const send = useMutation({
    mutationFn: () => sendEngageReply({ data: { ...ids, text } }),
    onSuccess: (r) => {
      if (r.status === "replied") toast.success(`Reply sent on ${PLATFORM_LABEL[c.platform]}`);
      else
        toast("Meta didn't confirm the reply", {
          description: "Press Send again: Mellox checks first.",
        });
      props.onChanged();
    },
    onError: (e) => {
      toast.error(errorText(e, "The reply didn't send."));
      props.onChanged();
    },
  });
  const sendDm = useMutation({
    mutationFn: () => sendEngageDm({ data: ids }),
    onSuccess: (r) => {
      if (r.dmStatus === "sent") toast.success("Private message sent");
      else toast(DM_LABEL[r.dmStatus] || "Message not sent");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "The message didn't send.")),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissEngageComment({ data: ids }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't dismiss it.")),
  });

  return (
    <li className="ds-tile space-y-3 p-4">
      <div className="flex items-start gap-3">
        <PlatformAppIcon platform={c.platform} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted-foreground">
            <span className="font-semibold text-foreground">{c.authorName ?? "Someone"}</span>
            {" · "}
            {ago(c.commentedAt)}
            {c.postPermalink && (
              <>
                {" · "}
                <a
                  href={c.postPermalink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline-offset-2 hover:underline"
                >
                  View post
                </a>
              </>
            )}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-snug">{c.body}</p>
          {c.postCaption && (
            <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
              On: {c.postCaption}
            </p>
          )}
          {(c.ruleName || c.dmStatus !== "none" || (!done && MOX_CHIP[c.moxState])) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!done && MOX_CHIP[c.moxState] && (
                <Chip tone={c.moxState === "waiting_info" ? "primary" : "warning"}>
                  {c.moxState === "waiting_info" ? (
                    <Brain className="size-3" />
                  ) : (
                    <MessageSquare className="size-3" />
                  )}
                  {MOX_CHIP[c.moxState]}
                </Chip>
              )}
              {c.ruleName && (
                <Chip tone="primary">
                  <Zap className="size-3" />
                  {c.ruleName}
                </Chip>
              )}
              {c.dmStatus !== "none" && (
                <Chip
                  tone={
                    c.dmStatus === "sent"
                      ? "success"
                      : c.dmStatus === "pending"
                        ? "default"
                        : "warning"
                  }
                >
                  <MessageSquare className="size-3" />
                  {DM_LABEL[c.dmStatus]}
                </Chip>
              )}
            </div>
          )}
          {!done && c.moxNote && c.moxState !== "none" && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {c.moxState === "waiting_info" ? "Mox asked you: " : ""}
              {c.moxNote}
            </p>
          )}
          {c.dmError && c.dmStatus !== "sent" && (
            <p className="mt-1 text-[12px] text-muted-foreground">{c.dmError}</p>
          )}
        </div>
      </div>

      {done ? (
        <div className="rounded-2xl bg-[var(--ds-well-bg)] px-3.5 py-3 text-[13.5px]">
          <p className="text-[12px] text-muted-foreground">
            {c.autoSent ? (c.ruleName ? "Quick reply sent" : "Mox replied") : "You replied"}
            {c.repliedAt ? ` ${ago(c.repliedAt)}` : ""}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap">{c.replyText}</p>
          {props.canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.replyText && (
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                  onClick={() => props.onTeach(c.body, c.replyText ?? "")}
                  title="Save this question and answer so Mox uses it next time"
                >
                  <Brain className="size-3.5" />
                  Teach Mox this answer
                </button>
              )}
              {c.dmStatus === "pending" && (
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                  onClick={() => sendDm.mutate()}
                  disabled={sendDm.isPending}
                >
                  <MessageSquare className="size-3.5" />
                  {sendDm.isPending ? "Sending…" : "Send the private message"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : props.canEdit ? (
        <div className="space-y-2">
          {c.dmStatus === "pending" && c.dmText && (
            <p className="rounded-2xl border border-dashed px-3.5 py-2.5 text-[12px] text-foreground/80">
              <span className="font-semibold text-muted-foreground">Also sent by DM: </span>
              {c.dmText}
            </p>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply, or let Mox draft one."
            rows={2}
            maxLength={limit}
            className="min-h-[64px] rounded-2xl text-[14px]"
            aria-label={`Reply to ${c.authorName ?? "this comment"}`}
          />
          {c.lastError && <p className="text-[12px] text-destructive">{c.lastError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
              onClick={() => draft.mutate()}
              disabled={draft.isPending || send.isPending}
            >
              <Sparkles className="size-4" />
              {draft.isPending ? "Writing…" : text ? "Draft again" : "Draft with Mox"}
            </button>
            <button
              type="button"
              className={cn(dsInkBtn, "h-9 px-4 text-[13px]")}
              onClick={() => send.mutate()}
              disabled={!text.trim() || send.isPending || draft.isPending || c.status === "sending"}
            >
              <Send className="size-4" />
              {send.isPending || c.status === "sending" ? "Sending…" : "Send"}
            </button>
            {c.dmStatus === "pending" && !text.trim() && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                onClick={() => sendDm.mutate()}
                disabled={sendDm.isPending}
              >
                <MessageSquare className="size-4" />
                Only the DM
              </button>
            )}
            <button
              type="button"
              className={cn(dsIconBtn, "ml-auto")}
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending || send.isPending}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ───────────────────────── what people ask ───────────────────────── */

type AnswerDraft = { id?: string; question: string; answer: string };

function AnswersTile(props: {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  teaching: AnswerDraft | null;
  setTeaching: (d: AnswerDraft | null) => void;
  onChanged: () => void;
}) {
  const { data, teaching, setTeaching, workspaceId } = props;
  const [showVoice, setShowVoice] = useState(false);
  const forget = useMutation({
    mutationFn: (id: string) => deleteEngageExample({ data: { workspaceId, id } }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't forget that.")),
  });
  return (
    <div className="ds-tile space-y-3 p-4" data-testid="inbox-answers">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="ds-label">What people ask</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Mox answers from these, and never makes up the rest.
          </p>
        </div>
        {props.canEdit && !teaching && data.answers.length < MAX_ANSWERS && (
          <button
            type="button"
            className={cn(dsIconBtn, "shrink-0")}
            aria-label="Add what people ask"
            title="Add"
            onClick={() => setTeaching({ question: "", answer: "" })}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {teaching && !teaching.id && (
        <AnswerForm
          workspaceId={workspaceId}
          initial={teaching}
          onClose={() => setTeaching(null)}
          onSaved={() => {
            setTeaching(null);
            props.onChanged();
          }}
        />
      )}

      {data.answers.length === 0 && !teaching ? (
        <button
          type="button"
          disabled={!props.canEdit}
          onClick={() => setTeaching({ question: "", answer: "" })}
          className={cn(
            "w-full rounded-2xl border border-dashed px-3.5 py-3 text-left text-[12.5px] text-muted-foreground hover:text-foreground",
            dsFocus,
          )}
        >
          Start with what people ask most: price, delivery, opening hours, where to buy.
        </button>
      ) : (
        <ul className="space-y-1.5">
          {data.answers.map((a) =>
            teaching?.id === a.id ? (
              <li key={a.id}>
                <AnswerForm
                  workspaceId={workspaceId}
                  initial={teaching}
                  onClose={() => setTeaching(null)}
                  onSaved={() => {
                    setTeaching(null);
                    props.onChanged();
                  }}
                />
              </li>
            ) : (
              <AnswerRow
                key={a.id}
                answer={a}
                workspaceId={workspaceId}
                canEdit={props.canEdit}
                onEdit={() => setTeaching({ id: a.id, question: a.question, answer: a.answer })}
                onChanged={props.onChanged}
              />
            ),
          )}
        </ul>
      )}

      {data.examples.length > 0 && (
        <div className="border-t border-border/60 pt-2.5">
          <button
            type="button"
            onClick={() => setShowVoice((v) => !v)}
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Mox learned your voice from {data.examples.length} sent{" "}
            {data.examples.length === 1 ? "reply" : "replies"} · {showVoice ? "Hide" : "See"}
          </button>
          {showVoice && (
            <ul className="mt-2 space-y-2">
              {data.examples.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-[12.5px]">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-muted-foreground">“{e.comment}”</p>
                    <p className="line-clamp-2">{e.reply}</p>
                  </div>
                  {props.canEdit && (
                    <button
                      type="button"
                      className={cn(dsIconBtn, "size-7")}
                      aria-label="Forget this reply"
                      title="Forget"
                      disabled={forget.isPending}
                      onClick={() => forget.mutate(e.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerRow(props: {
  answer: EngageAnswer;
  workspaceId: string;
  canEdit: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const remove = useMutation({
    mutationFn: () =>
      deleteEngageAnswer({ data: { workspaceId: props.workspaceId, id: props.answer.id } }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't remove it.")),
  });
  return (
    <li className="group flex items-start gap-2 rounded-xl bg-[var(--ds-well-bg)] px-3 py-2">
      <button
        type="button"
        disabled={!props.canEdit}
        onClick={props.onEdit}
        className={cn("min-w-0 flex-1 text-left", dsFocus)}
        title={props.canEdit ? "Edit" : undefined}
      >
        <p className="text-[13px] font-semibold leading-snug">{props.answer.question}</p>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-foreground/75">
          {props.answer.answer}
        </p>
      </button>
      {props.canEdit && (
        <button
          type="button"
          className={cn(dsIconBtn, "size-7 opacity-60 group-hover:opacity-100")}
          aria-label="Remove"
          title="Remove"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash className="size-3.5" />
        </button>
      )}
    </li>
  );
}

function AnswerForm(props: {
  workspaceId: string;
  initial: AnswerDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState(props.initial.question);
  const [answer, setAnswer] = useState(props.initial.answer);
  useEffect(() => {
    setQuestion(props.initial.question);
    setAnswer(props.initial.answer);
  }, [props.initial]);
  const check = tidyAnswer(question, answer);
  const save = useMutation({
    mutationFn: () =>
      saveEngageAnswer({
        data: { workspaceId: props.workspaceId, id: props.initial.id, question, answer },
      }),
    onSuccess: () => {
      toast.success("Mox learned it");
      props.onSaved();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't save the answer.")),
  });
  return (
    <div className="space-y-2 rounded-2xl bg-[var(--ds-well-bg)] p-2.5">
      <Input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What do people ask?"
        maxLength={300}
        className="h-9 rounded-full bg-card text-[13px]"
        aria-label="What people ask"
        autoFocus
      />
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Your answer, e.g. Yes, we deliver in 2–3 days."
        rows={2}
        maxLength={1_500}
        className="min-h-[60px] rounded-2xl bg-card text-[13px]"
        aria-label="Your answer"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          onClick={props.onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12px]")}
          disabled={!check.ok || save.isPending}
          onClick={() => save.mutate()}
        >
          <Check className="size-3.5" />
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── quick replies ───────────────────────── */

const BLANK_RULE: RuleInput = {
  name: "",
  platforms: ["instagram", "facebook"],
  postScope: "any",
  postIds: [],
  match: "keywords",
  keywords: [],
  wholeWord: true,
  replyMode: "fixed",
  replies: [""],
  moxGuidance: null,
  dmEnabled: false,
  dmMessage: null,
  dmLink: null,
  sendMode: "auto",
};

function toInput(rule: EngageRule): RuleInput {
  return {
    name: rule.name,
    platforms: rule.platforms,
    postScope: rule.postScope,
    postIds: rule.postIds,
    match: rule.match,
    keywords: rule.keywords,
    wholeWord: rule.wholeWord,
    replyMode: rule.replyMode,
    replies: rule.replies.length ? rule.replies : [""],
    moxGuidance: rule.moxGuidance,
    dmEnabled: rule.dmEnabled,
    dmMessage: rule.dmMessage,
    dmLink: rule.dmLink,
    sendMode: rule.sendMode,
  };
}

/** The starting points that fit the short form (no post picking). */
const QUICK_TEMPLATES = RULE_TEMPLATES.filter((t) => t.rule.postScope !== "posts");

function ruleLine(rule: EngageRule): string {
  const when =
    rule.match === "any"
      ? "Any comment"
      : rule.keywords
          .slice(0, 3)
          .map((k) => `“${k}”`)
          .join(", ") + (rule.keywords.length > 3 ? ` +${rule.keywords.length - 3}` : "");
  const then = [
    rule.replyMode === "fixed" ? "reply" : rule.replyMode === "mox" ? "Mox drafts" : "",
    rule.dmEnabled ? "DM" : "",
  ]
    .filter(Boolean)
    .join(" + ");
  return `${when} → ${then}`;
}

function QuickRepliesTile(props: {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  onToggleAll: (on: boolean) => void;
  toggling: boolean;
  onOpen: (f: { id?: string; input: RuleInput }) => void;
  onChanged: () => void;
}) {
  const { data, workspaceId } = props;
  const status = useMutation({
    mutationFn: (v: { id: string; live: boolean }) =>
      setEngageRuleStatus({ data: { workspaceId, id: v.id, status: v.live ? "live" : "paused" } }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't change that.")),
  });
  return (
    <div className="ds-tile space-y-3 p-4" data-testid="inbox-quick-replies">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="ds-label">Quick replies</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Exact words for a keyword, like a link by DM. They go before Mox.
          </p>
        </div>
        {props.canEdit && data.rules.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            <Switch
              checked={data.automationsOn}
              disabled={props.toggling}
              onCheckedChange={props.onToggleAll}
              aria-label="Quick replies on"
            />
            {data.rules.length < MAX_RULES && (
              <button
                type="button"
                className={dsIconBtn}
                aria-label="New quick reply"
                title="New quick reply"
                onClick={() => props.onOpen({ input: BLANK_RULE })}
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {data.rules.length === 0 ? (
        props.canEdit ? (
          <div className="space-y-1.5">
            {QUICK_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => props.onOpen({ input: { ...BLANK_RULE, ...t.rule } })}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl bg-[var(--ds-well-bg)] px-3 py-2.5 text-left hover:bg-foreground/[0.06]",
                  dsFocus,
                )}
              >
                <Zap className="size-4 shrink-0 text-primary-ink" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{t.title}</span>
                  <span className="block text-[12px] text-muted-foreground">{t.blurb}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => props.onOpen({ input: BLANK_RULE })}
              className="w-full px-1 pt-1 text-left text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              Or start from scratch
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">None yet.</p>
        )
      ) : (
        <ul className="space-y-1.5">
          {data.rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-xl bg-[var(--ds-well-bg)] px-3 py-2"
            >
              <button
                type="button"
                disabled={!props.canEdit}
                onClick={() => props.onOpen({ id: r.id, input: toInput(r) })}
                className={cn("min-w-0 flex-1 text-left", dsFocus)}
                title={props.canEdit ? "Edit" : undefined}
              >
                <p
                  className={cn(
                    "truncate text-[13px] font-semibold",
                    r.status !== "live" && "text-muted-foreground",
                  )}
                >
                  {r.name}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {ruleLine(r)}
                  {r.sentCount ? ` · ${r.sentCount} sent` : ""}
                </p>
              </button>
              {props.canEdit && (
                <Switch
                  checked={r.status === "live"}
                  disabled={status.isPending}
                  onCheckedChange={(live) => status.mutate({ id: r.id, live })}
                  aria-label={`${r.name} on`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickReplyDialog(props: {
  workspaceId: string;
  data: EngageHome;
  id?: string;
  initial: RuleInput;
  onClose: () => void;
  onSaved: () => void;
  onReconnect: () => void;
}) {
  const [r, setR] = useState<RuleInput>(props.initial);
  const [word, setWord] = useState("");
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setR((x) => ({ ...x, [k]: v }));
  // The name follows the first word unless the person's rule already had one.
  const withName = useMemo<RuleInput>(
    () => ({
      ...r,
      name: r.name.trim() || (r.keywords[0] ? `“${r.keywords[0]}”` : "Quick reply"),
    }),
    [r],
  );
  const check = useMemo(() => tidyRule(withName), [withName]);
  const canMessage = props.data.connection?.canMessage ?? { instagram: false, facebook: false };
  const missingDm = r.dmEnabled && r.platforms.some((p) => !canMessage[p]);
  const extraReplies = r.replies.length - 1;

  const save = useMutation({
    mutationFn: () =>
      saveEngageRule({ data: { workspaceId: props.workspaceId, id: props.id, rule: withName } }),
    onSuccess: () => {
      toast.success(props.id ? "Quick reply saved" : "Quick reply is on");
      props.onSaved();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't save it.")),
  });
  const remove = useMutation({
    mutationFn: () => deleteEngageRule({ data: { workspaceId: props.workspaceId, id: props.id! } }),
    onSuccess: () => {
      toast.success("Quick reply removed");
      props.onSaved();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't remove it.")),
  });

  const addWords = (raw: string) => {
    const next = [...r.keywords];
    for (const p of raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean))
      if (!next.some((k) => k.toLowerCase() === p.toLowerCase()) && next.length < MAX_KEYWORDS)
        next.push(p.slice(0, 60));
    set("keywords", next);
    setWord("");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-[460px] gap-4 rounded-[28px]">
        <DialogHeader>
          <DialogTitle>{props.id ? "Edit quick reply" : "New quick reply"}</DialogTitle>
          <DialogDescription>
            On Instagram and Facebook, on every post. Answered once per comment.
          </DialogDescription>
        </DialogHeader>

        {/* 1. the words */}
        {r.match === "keywords" ? (
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold">When a comment says</p>
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/70 px-2 py-1.5">
              {r.keywords.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] py-0.5 pl-2.5 pr-1 text-[12.5px]"
                >
                  {k}
                  <button
                    type="button"
                    aria-label={`Remove ${k}`}
                    className="grid size-5 place-items-center rounded-full hover:bg-foreground/10"
                    onClick={() =>
                      set(
                        "keywords",
                        r.keywords.filter((x) => x !== k),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addWords(word);
                  } else if (e.key === "Backspace" && !word && r.keywords.length)
                    set("keywords", r.keywords.slice(0, -1));
                }}
                onBlur={() => word.trim() && addWords(word)}
                placeholder={r.keywords.length ? "Add a word" : "link, price, menu…"}
                className="h-7 min-w-[110px] flex-1 bg-transparent px-1 text-[13px] outline-none"
                aria-label="Words to listen for"
                autoFocus
              />
            </div>
          </div>
        ) : (
          <p className="rounded-2xl bg-[var(--ds-well-bg)] px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
            Answers every comment
            {r.postScope === "posts" ? ` on ${r.postIds.length} chosen posts` : ""}.
          </p>
        )}

        {/* 2. the reply */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Reply</p>
            <div
              className="inline-flex rounded-full bg-[var(--ds-well-bg)] p-0.5"
              role="radiogroup"
            >
              {(
                [
                  ["fixed", "My words"],
                  ["mox", "Mox writes"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={r.replyMode === id}
                  onClick={() => set("replyMode", id)}
                  className={cn(
                    "h-7 rounded-full px-3 text-[12px] font-semibold",
                    r.replyMode === id ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {r.replyMode === "mox" ? (
            <>
              <Textarea
                value={r.moxGuidance ?? ""}
                onChange={(e) => set("moxGuidance", e.target.value || null)}
                placeholder="Optional: how to answer, e.g. give the price, then invite them to DM."
                rows={2}
                maxLength={1000}
                className="min-h-[60px] rounded-2xl text-[13px]"
              />
              <p className="text-[12px] text-muted-foreground">
                Mox drafts from What people ask; the reply waits for you to send it.
              </p>
            </>
          ) : (
            <>
              <Textarea
                value={r.replies[0] ?? ""}
                onChange={(e) => set("replies", [e.target.value, ...r.replies.slice(1)])}
                placeholder="Thanks {name}! Sent it to your DMs."
                rows={2}
                maxLength={2200}
                className="min-h-[60px] rounded-2xl text-[13px]"
              />
              <p className="text-[12px] text-muted-foreground">
                {"{name}"} becomes their first name.
                {extraReplies > 0
                  ? ` ${extraReplies} more ${extraReplies === 1 ? "version is" : "versions are"} kept and rotated.`
                  : ""}
              </p>
            </>
          )}
        </div>

        {/* 3. the link by DM */}
        <div className="space-y-2 rounded-2xl bg-[var(--ds-well-bg)] px-3.5 py-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-[13px] font-semibold">Also send a link by DM</span>
            <Switch
              checked={r.dmEnabled}
              onCheckedChange={(on) =>
                setR((x) => ({
                  ...x,
                  dmEnabled: on,
                  dmMessage: on
                    ? x.dmMessage || "Hi {name}! Here's the link you asked for:"
                    : x.dmMessage,
                }))
              }
              aria-label="Also send a link by DM"
            />
          </label>
          {r.dmEnabled && (
            <>
              <Input
                value={r.dmLink ?? ""}
                onChange={(e) => set("dmLink", e.target.value || null)}
                placeholder="https://yoursite.com/menu"
                inputMode="url"
                className="h-9 rounded-full bg-card text-[13px]"
                aria-label="Link"
              />
              {missingDm && (
                <p className="text-[12px] text-warning">
                  Messages need one more permission from Meta.{" "}
                  <button type="button" className="underline" onClick={props.onReconnect}>
                    Reconnect
                  </button>
                </p>
              )}
            </>
          )}
        </div>

        {/* 4. by itself, or ask first */}
        {r.replyMode !== "mox" && (
          <label className="flex cursor-pointer items-center justify-between gap-3 px-0.5">
            <span>
              <span className="block text-[13px] font-semibold">Send by itself</span>
              <span className="block text-[12px] text-muted-foreground">
                Off: it waits in Waiting for you to press Send.
              </span>
            </span>
            <Switch
              checked={r.sendMode === "auto"}
              onCheckedChange={(on) => set("sendMode", on ? "auto" : "approve")}
              aria-label="Send by itself"
            />
          </label>
        )}

        {!check.ok && (r.keywords.length > 0 || r.replies[0]) && (
          <p className="text-[12.5px] text-warning">{check.reason}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {props.id && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 border-transparent px-3 text-[13px] text-destructive")}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <Trash className="size-4" />
              Remove
            </button>
          )}
          <button
            type="button"
            className={cn(dsGhostBtn, "ml-auto h-9 px-4 text-[13px]")}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
            disabled={!check.ok || save.isPending}
            onClick={() => save.mutate()}
          >
            <Check className="size-4" />
            {save.isPending ? "Saving…" : props.id ? "Save" : "Turn on"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── the account ───────────────────────── */

function AccountTile(props: InboxScreenProps) {
  const { data } = props;
  return (
    <div className="ds-tile space-y-2 p-4">
      <p className="ds-label">Connected</p>
      <ul className="space-y-1.5">
        {data.pages.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-[12.5px]">
            <PlatformAppIcon platform={p.hasInstagram ? "instagram" : "facebook"} size={18} />
            <span className="min-w-0 flex-1 truncate">
              {p.pageName}
              {p.igUsername ? ` · @${p.igUsername}` : ""}
            </span>
            {p.lastError && (
              <span className="truncate text-destructive" title={p.lastError}>
                needs a look
              </span>
            )}
          </li>
        ))}
      </ul>
      {props.canEdit && (
        <button
          type="button"
          onClick={props.onDisconnect}
          className="text-[12px] text-muted-foreground hover:text-destructive"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
