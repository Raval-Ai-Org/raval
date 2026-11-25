"use client";
// Automations — ManyChat-style "when someone comments → reply / DM".
// The list, a When → Then builder, templates and a free "Try a comment"
// that runs the same pure `pickRule` the server does.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Pencil,
  Plus,
  Sparkles,
  Trash,
  X,
  Zap,
} from "@/components/icons";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  deleteEngageRule,
  listEngagePosts,
  reorderEngageRules,
  saveEngageRule,
  setEngageAutomations,
  setEngageRuleStatus,
  type EngageHome,
  type EngageRule,
  type RuleInput,
} from "@/lib/engage.functions";
import {
  MAX_KEYWORDS,
  MAX_REPLIES,
  RULE_TEMPLATES,
  dmText,
  personalize,
  pickReply,
  pickRule,
  tidyRule,
} from "@/lib/engage/rules";
import type { EngagePlatform } from "@/lib/engage/contracts";
import { Chip, PlatformToggles, Segmented, engageKeys, errorText } from "./engage-shared";

const BLANK: RuleInput = {
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

export function AutomationsTab(props: {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  onChanged: () => void;
  onReconnect: () => void;
}) {
  const { data, workspaceId } = props;
  const [editing, setEditing] = useState<{ id?: string; input: RuleInput } | null>(null);

  const toggleAll = useMutation({
    mutationFn: (on: boolean) => setEngageAutomations({ data: { workspaceId, on } }),
    onSuccess: (_r, on) => {
      toast.success(on ? "Automations are on" : "Automations are paused");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't change that.")),
  });

  if (editing)
    return (
      <RuleBuilder
        workspaceId={workspaceId}
        data={data}
        id={editing.id}
        initial={editing.input}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          props.onChanged();
        }}
        onReconnect={props.onReconnect}
      />
    );

  return (
    <SurfacePage
      width="wide"
      title="Automations"
      actions={
        props.canEdit && (
          <>
            <label className="flex items-center gap-2 text-[13px] font-semibold">
              <Switch
                checked={data.automationsOn}
                onCheckedChange={(on) => toggleAll.mutate(on)}
                disabled={toggleAll.isPending}
                aria-label="Automations on"
              />
              {data.automationsOn ? "On" : "Paused"}
            </label>
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              onClick={() => setEditing({ input: { ...BLANK } })}
            >
              <Plus className="size-4" />
              New automation
            </button>
          </>
        )
      }
    >
      <p className="-mt-3 mb-5 max-w-2xl text-sm text-muted-foreground">
        When someone comments on your posts, Mellox can reply for you and send a private message. It
        checks about every three minutes. Fixed replies can go out by themselves; anything Mox
        writes waits for you in Comments.
      </p>

      {data.rules.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Zap}
          title="No automations yet"
          description="Start from a template below, or build your own."
        />
      ) : (
        <ul className="space-y-3">
          {data.rules.map((rule, i) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={i}
              all={data.rules}
              workspaceId={workspaceId}
              canEdit={props.canEdit}
              paused={!data.automationsOn}
              onEdit={() => setEditing({ id: rule.id, input: toInput(rule) })}
              onChanged={props.onChanged}
            />
          ))}
        </ul>
      )}

      {props.canEdit && (
        <>
          <GroupLabel>Start from a template</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            {RULE_TEMPLATES.map((t) => (
              <Tile
                key={t.id}
                as="article"
                interactive
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => setEditing({ input: { ...BLANK, ...t.rule } as RuleInput })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setEditing({ input: { ...BLANK, ...t.rule } as RuleInput });
                }}
              >
                <span className="ds-grad-pill mb-3 grid size-9 place-items-center rounded-full text-[var(--mox-ink)]">
                  {t.rule.dmEnabled ? (
                    <MessageSquare className="size-4" />
                  ) : t.rule.replyMode === "mox" ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <Zap className="size-4" />
                  )}
                </span>
                <p className="text-sm font-semibold">{t.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.blurb}</p>
              </Tile>
            ))}
          </div>
        </>
      )}

      {data.rules.length > 0 && <TryComment rules={data.rules} />}
    </SurfacePage>
  );
}

function summary(rule: EngageRule | RuleInput): string {
  const when =
    rule.match === "any"
      ? "Any comment"
      : `Comments with ${rule.keywords
          .slice(0, 4)
          .map((k) => `“${k}”`)
          .join(", ")}${rule.keywords.length > 4 ? ` +${rule.keywords.length - 4}` : ""}`;
  const where =
    rule.postScope === "any"
      ? "on any post"
      : `on ${rule.postIds.length} chosen post${rule.postIds.length === 1 ? "" : "s"}`;
  const then = [
    rule.replyMode === "fixed"
      ? `reply (${rule.replies.filter(Boolean).length} version${rule.replies.filter(Boolean).length === 1 ? "" : "s"})`
      : rule.replyMode === "mox"
        ? "Mox drafts a reply"
        : "",
    rule.dmEnabled ? "send a DM" : "",
  ]
    .filter(Boolean)
    .join(" + ");
  return `${when} ${where} → ${then}`;
}

function RuleCard(props: {
  rule: EngageRule;
  index: number;
  all: EngageRule[];
  workspaceId: string;
  canEdit: boolean;
  paused: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { rule, workspaceId } = props;
  const status = useMutation({
    mutationFn: (live: boolean) =>
      setEngageRuleStatus({ data: { workspaceId, id: rule.id, status: live ? "live" : "paused" } }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't change that.")),
  });
  const remove = useMutation({
    mutationFn: () => deleteEngageRule({ data: { workspaceId, id: rule.id } }),
    onSuccess: () => {
      toast.success("Automation removed");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't remove it.")),
  });
  const move = useMutation({
    mutationFn: (dir: -1 | 1) => {
      const ids = props.all.map((r) => r.id);
      const j = props.index + dir;
      [ids[props.index], ids[j]] = [ids[j], ids[props.index]];
      return reorderEngageRules({ data: { workspaceId, ids } });
    },
    onSuccess: props.onChanged,
  });
  const auto = rule.sendMode === "auto" && rule.replyMode !== "mox";
  const live = rule.status === "live";

  return (
    <Tile as="li" className={cn(!live && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-2xl",
            live && !props.paused
              ? "ds-grad-pill text-[var(--mox-ink)]"
              : "bg-foreground/[0.06] text-muted-foreground",
          )}
        >
          <Zap className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold">{rule.name}</p>
            <span className="flex gap-1">
              {rule.platforms.map((p) => (
                <PlatformAppIcon key={p} platform={p} size={16} />
              ))}
            </span>
            <Chip tone={auto ? "primary" : "default"}>
              {auto ? "Sends by itself" : "Asks you first"}
            </Chip>
            {!live && <Chip>Paused</Chip>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{summary(rule)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {rule.matchedCount} matched · {rule.sentCount} replied · {rule.dmCount} DMs
          </p>
        </div>
        {props.canEdit && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={dsIconBtn}
              aria-label="Move up"
              disabled={props.index === 0 || move.isPending}
              onClick={() => move.mutate(-1)}
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              className={dsIconBtn}
              aria-label="Move down"
              disabled={props.index === props.all.length - 1 || move.isPending}
              onClick={() => move.mutate(1)}
            >
              <ChevronDown className="size-4" />
            </button>
            <button type="button" className={dsIconBtn} aria-label="Edit" onClick={props.onEdit}>
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className={dsIconBtn}
              aria-label="Remove"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove “${rule.name}”?`)) remove.mutate();
              }}
            >
              <Trash className="size-4" />
            </button>
            <Switch
              className="ml-1"
              checked={live}
              disabled={status.isPending}
              onCheckedChange={(on) => status.mutate(on)}
              aria-label={live ? "Pause" : "Turn on"}
            />
          </div>
        )}
      </div>
    </Tile>
  );
}

// ── Builder ───────────────────────────────────────────────────────────────

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Tile className="relative">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="ds-grad-pill grid size-7 place-items-center rounded-full text-xs font-bold text-[var(--mox-ink)]">
          {n}
        </span>
        <h4 className="text-[15px] font-semibold">{title}</h4>
      </div>
      <div className="space-y-4">{children}</div>
    </Tile>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RuleBuilder(props: {
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
  const check = useMemo(() => tidyRule(r), [r]);
  const canMessage = props.data.connection?.canMessage ?? { instagram: false, facebook: false };
  const missingDm = r.dmEnabled && r.platforms.some((p) => !canMessage[p]);

  const save = useMutation({
    mutationFn: () =>
      saveEngageRule({ data: { workspaceId: props.workspaceId, id: props.id, rule: r } }),
    onSuccess: () => {
      toast.success(props.id ? "Automation saved" : "Automation is live");
      props.onSaved();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't save the automation.")),
  });

  const addWords = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...r.keywords];
    for (const p of parts)
      if (!next.some((k) => k.toLowerCase() === p.toLowerCase()) && next.length < MAX_KEYWORDS)
        next.push(p.slice(0, 60));
    set("keywords", next);
    setWord("");
  };

  return (
    <SurfacePage
      width="narrow"
      title={props.id ? "Edit automation" : "New automation"}
      actions={
        <button
          type="button"
          className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
          onClick={props.onClose}
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={r.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Link by DM"
            maxLength={80}
            className="rounded-full"
          />
        </Field>

        <Step n={1} title="When someone comments">
          <Field label="On">
            <PlatformToggles value={r.platforms} onChange={(v) => set("platforms", v)} />
          </Field>
          <Field label="Which posts">
            <Segmented<"any" | "posts">
              value={r.postScope}
              onChange={(v) => set("postScope", v)}
              options={[
                { id: "any", label: "Any post" },
                { id: "posts", label: "Chosen posts" },
              ]}
            />
            {r.postScope === "posts" && (
              <PostPicker
                workspaceId={props.workspaceId}
                platforms={r.platforms}
                value={r.postIds}
                onChange={(v) => set("postIds", v)}
              />
            )}
          </Field>
          <Field label="With">
            <Segmented<"keywords" | "any">
              value={r.match}
              onChange={(v) => set("match", v)}
              options={[
                { id: "keywords", label: "These words" },
                { id: "any", label: "Any comment" },
              ]}
            />
            {r.match === "keywords" && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1.5 rounded-2xl border bg-card p-2">
                  {r.keywords.map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/15 py-1 pl-3 pr-1 text-[13px] font-semibold text-primary-ink"
                    >
                      {k}
                      <button
                        type="button"
                        aria-label={`Remove ${k}`}
                        className="grid size-5 place-items-center rounded-full hover:bg-black/10"
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
                    onBlur={() => addWords(word)}
                    placeholder={r.keywords.length ? "Add another…" : "link, price, info…"}
                    className="min-w-[8rem] flex-1 bg-transparent px-2 py-1 text-sm outline-none"
                    aria-label="Words to listen for"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={r.wholeWord} onCheckedChange={(v) => set("wholeWord", v)} />
                  Whole words only (“link” won’t match “linking”). Any case, accents and emoji are
                  ignored.
                </label>
              </div>
            )}
          </Field>
        </Step>

        <Step n={2} title="Reply in the comments">
          <Segmented<RuleInput["replyMode"]>
            value={r.replyMode}
            onChange={(v) => {
              set("replyMode", v);
              if (v === "mox") set("sendMode", "approve");
            }}
            options={[
              { id: "fixed", label: "My words" },
              { id: "mox", label: "Mox writes it" },
              { id: "none", label: "No public reply" },
            ]}
          />
          {r.replyMode === "fixed" && (
            <Field
              label="Replies"
              hint="Add a few versions: Mellox rotates them so replies don't look copied. {name} becomes the person's first name."
            >
              <div className="space-y-2">
                {r.replies.map((text, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Textarea
                      value={text}
                      rows={2}
                      maxLength={2_200}
                      className="rounded-2xl"
                      placeholder={
                        i === 0 ? "Sent it to your messages, {name}!" : "Another version…"
                      }
                      onChange={(e) =>
                        set(
                          "replies",
                          r.replies.map((x, j) => (j === i ? e.target.value : x)),
                        )
                      }
                    />
                    {r.replies.length > 1 && (
                      <button
                        type="button"
                        className={dsIconBtn}
                        aria-label="Remove this version"
                        onClick={() =>
                          set(
                            "replies",
                            r.replies.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
                {r.replies.length < MAX_REPLIES && (
                  <button
                    type="button"
                    className={cn(dsGhostBtn, "h-8 px-3 text-xs")}
                    onClick={() => set("replies", [...r.replies, ""])}
                  >
                    <Plus className="size-3.5" />
                    Another version
                  </button>
                )}
              </div>
            </Field>
          )}
          {r.replyMode === "mox" && (
            <Field
              label="What Mox should do"
              hint="Mox also uses the answers in Train Mox and your Brand DNA. Its replies always wait for you to press Send."
            >
              <Textarea
                value={r.moxGuidance ?? ""}
                rows={3}
                maxLength={1_000}
                className="rounded-2xl"
                placeholder="Answer price questions from our price list. If unsure, invite them to DM us."
                onChange={(e) => set("moxGuidance", e.target.value)}
              />
            </Field>
          )}
        </Step>

        <Step n={3} title="Send a private message">
          <label className="flex items-center gap-2.5 text-sm font-medium">
            <Switch checked={r.dmEnabled} onCheckedChange={(v) => set("dmEnabled", v)} />
            Also message them privately
          </label>
          {r.dmEnabled && (
            <>
              <Field
                label="Message"
                hint="{name} becomes the person's first name. Meta allows one private message per comment."
              >
                <Textarea
                  value={r.dmMessage ?? ""}
                  rows={3}
                  maxLength={1_000}
                  className="rounded-2xl"
                  placeholder="Hi {name}! Here's the link you asked for:"
                  onChange={(e) => set("dmMessage", e.target.value)}
                />
              </Field>
              <Field label="Link (optional)">
                <Input
                  value={r.dmLink ?? ""}
                  onChange={(e) => set("dmLink", e.target.value)}
                  placeholder="https://"
                  inputMode="url"
                  className="rounded-full"
                />
              </Field>
              {missingDm && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-warning/10 p-3 text-xs text-warning">
                  <span className="flex-1">
                    Private messages need one more permission from Meta. Reconnect and allow
                    messages; until then the public reply still goes out.
                  </span>
                  <button
                    type="button"
                    className={cn(dsGhostBtn, "h-8 px-3 text-xs")}
                    onClick={props.onReconnect}
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </>
          )}
        </Step>

        <Step n={4} title="How it sends">
          <Segmented<RuleInput["sendMode"]>
            value={r.replyMode === "mox" ? "approve" : r.sendMode}
            disabled={r.replyMode === "mox"}
            onChange={(v) => set("sendMode", v)}
            options={[
              { id: "auto", label: "By itself" },
              { id: "approve", label: "Ask me first" },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {r.replyMode === "mox"
              ? "Replies Mox writes always wait for you in Comments."
              : r.sendMode === "auto"
                ? "Goes out within a few minutes of the comment, up to 60 an hour. Only comments written after you save are answered."
                : "Each match waits in Comments with your reply filled in. You press Send."}
          </p>
        </Step>

        <Tile className="flex flex-wrap items-center gap-3">
          <p
            className={cn(
              "min-w-0 flex-1 text-sm",
              check.ok ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {check.ok ? summary(check.rule) : check.reason}
          </p>
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-10 px-5 text-sm")}
            disabled={!check.ok || save.isPending}
            onClick={() => save.mutate()}
          >
            <Check className="size-4" />
            {save.isPending ? "Saving…" : props.id ? "Save" : "Save and turn on"}
          </button>
        </Tile>
      </div>
    </SurfacePage>
  );
}

function PostPicker(props: {
  workspaceId: string;
  platforms: EngagePlatform[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const posts = useQuery({
    queryKey: engageKeys.posts(props.workspaceId),
    queryFn: () => listEngagePosts({ data: { workspaceId: props.workspaceId } }),
    staleTime: 5 * 60_000,
  });
  if (posts.isLoading)
    return (
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl" />
        ))}
      </div>
    );
  if (posts.error)
    return (
      <p className="mt-3 text-xs text-destructive">
        {errorText(posts.error, "Posts didn't load.")}
      </p>
    );
  const list = (posts.data ?? []).filter((p) => props.platforms.includes(p.platform));
  if (!list.length)
    return <p className="mt-3 text-xs text-muted-foreground">No recent posts found.</p>;
  return (
    <div className="mt-3 grid max-h-[340px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
      {list.map((p) => {
        const on = props.value.includes(p.id);
        return (
          <button
            key={`${p.platform}:${p.id}`}
            type="button"
            aria-pressed={on}
            title={p.caption ?? ""}
            onClick={() =>
              props.onChange(on ? props.value.filter((v) => v !== p.id) : [...props.value, p.id])
            }
            className={cn(
              "relative aspect-square overflow-hidden rounded-2xl border-2 bg-[var(--ds-well-bg)] text-left transition-all",
              on ? "border-foreground" : "border-transparent hover:border-foreground/20",
            )}
          >
            {p.thumbnail ? (
              <img src={p.thumbnail} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <span className="line-clamp-4 p-2 text-[11px] text-muted-foreground">
                {p.caption ?? "Post"}
              </span>
            )}
            <span className="absolute left-1.5 top-1.5">
              <PlatformAppIcon platform={p.platform} size={16} />
            </span>
            {on && (
              <span className="ds-grad-pill absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full text-[var(--mox-ink)]">
                <Check className="size-3.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Try a comment (free, in the browser) ──────────────────────────────────

function TryComment({ rules }: { rules: EngageRule[] }) {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<EngagePlatform>("instagram");
  const hit = text.trim()
    ? pickRule(
        // A test comment counts as just written, on any post a rule picked.
        {
          id: text,
          platform,
          postId: "__test__",
          body: text,
          commentedAt: new Date().toISOString(),
        },
        rules.map((r) =>
          r.postScope === "posts" ? { ...r, postIds: [...r.postIds, "__test__"] } : r,
        ),
      )
    : null;
  const reply =
    hit?.rule.replyMode === "fixed"
      ? personalize(pickReply(hit.rule.replies, text) ?? "", "Sara Khan")
      : null;
  const dm = hit?.rule.dmEnabled ? dmText(hit.rule, "Sara Khan") : null;
  return (
    <>
      <GroupLabel>Try a comment</GroupLabel>
      <Tile>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<EngagePlatform>
            value={platform}
            onChange={setPlatform}
            options={[
              { id: "instagram", label: "Instagram" },
              { id: "facebook", label: "Facebook" },
            ]}
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a comment, like “price plz” or “LINK 🔥”"
            className="min-w-[14rem] flex-1 rounded-full"
          />
        </div>
        {text.trim() && (
          <div className="mt-3 rounded-2xl bg-[var(--ds-well-bg)] p-3 text-sm">
            {!hit ? (
              <p className="text-muted-foreground">
                No live automation answers this. It waits in Comments.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p>
                  <Chip tone="primary">
                    <Zap className="size-3" />
                    {hit.rule.name}
                  </Chip>{" "}
                  {hit.keyword ? `heard “${hit.keyword}”` : "answers any comment"}
                </p>
                {reply && <p>Reply: {reply}</p>}
                {hit.rule.replyMode === "mox" && (
                  <p className="text-muted-foreground">Mox drafts a reply for you to send.</p>
                )}
                {dm && <p className="whitespace-pre-wrap">DM: {dm}</p>}
              </div>
            )}
          </div>
        )}
      </Tile>
    </>
  );
}
