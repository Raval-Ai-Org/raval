"use client";
// Train Mox — what the team teaches Mox about answering comments:
//   * answers ("Do you ship to Lahore?" → "Yes, in 2–3 days"): facts Mox
//     may use in every draft;
//   * learned replies: what people on the team sent, used for the voice
//     only. Any of them can be forgotten.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Check, MessageSquare, Pencil, Plus, Trash, X } from "@/components/icons";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  deleteEngageAnswer,
  deleteEngageExample,
  saveEngageAnswer,
  type EngageAnswer,
  type EngageHome,
} from "@/lib/engage.functions";
import { MAX_ANSWERS, tidyAnswer } from "@/lib/engage/training";
import { ago, errorText } from "./engage-shared";

export function TrainTab(props: {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { data, workspaceId } = props;
  const [editing, setEditing] = useState<{ id?: string; question: string; answer: string } | null>(
    null,
  );
  const forget = useMutation({
    mutationFn: (id: string) => deleteEngageExample({ data: { workspaceId, id } }),
    onSuccess: props.onChanged,
    onError: (e) => toast.error(errorText(e, "Couldn't forget that.")),
  });

  return (
    <SurfacePage
      width="wide"
      title="Train Mox"
      actions={
        props.canEdit &&
        !editing &&
        data.answers.length < MAX_ANSWERS && (
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
            onClick={() => setEditing({ question: "", answer: "" })}
          >
            <Plus className="size-4" />
            Teach an answer
          </button>
        )
      }
    >
      <p className="-mt-3 mb-5 max-w-2xl text-sm text-muted-foreground">
        Teach Mox what people ask and how you answer. Mox uses these answers in every reply it
        drafts and never makes up a price, date or promise that isn’t here or in your Brand DNA.
      </p>

      <GroupLabel>Answers Mox can use · {data.answers.length}</GroupLabel>
      {editing && (
        <AnswerForm
          workspaceId={workspaceId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            props.onChanged();
          }}
        />
      )}
      {data.answers.length === 0 && !editing ? (
        <EmptyState
          size="sm"
          icon={Brain}
          title="Nothing taught yet"
          description="Start with what people ask most: price, delivery, opening hours, where to buy."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.answers
            .filter((a) => a.id !== editing?.id)
            .map((a) => (
              <AnswerCard
                key={a.id}
                answer={a}
                workspaceId={workspaceId}
                canEdit={props.canEdit}
                onEdit={() => setEditing({ id: a.id, question: a.question, answer: a.answer })}
                onChanged={props.onChanged}
              />
            ))}
        </ul>
      )}

      <GroupLabel>Learned from your replies · {data.examples.length}</GroupLabel>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        Replies your team sends teach Mox how you sound. Only the voice is used, never the facts.
      </p>
      {data.examples.length === 0 ? (
        <EmptyState
          size="sm"
          icon={MessageSquare}
          title="No replies yet"
          description="Send a few replies from Comments and Mox starts sounding like you."
        />
      ) : (
        <ul className="space-y-2">
          {data.examples.map((e) => (
            <Tile as="li" key={e.id} className="flex items-start gap-3 py-3 sm:py-3">
              <PlatformAppIcon platform={e.platform} size={22} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="line-clamp-2 text-muted-foreground">“{e.comment}”</p>
                <p className="mt-1 line-clamp-3">{e.reply}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{ago(e.createdAt)}</p>
              </div>
              {props.canEdit && (
                <button
                  type="button"
                  className={dsIconBtn}
                  aria-label="Forget this reply"
                  title="Forget"
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(e.id)}
                >
                  <X className="size-4" />
                </button>
              )}
            </Tile>
          ))}
        </ul>
      )}
    </SurfacePage>
  );
}

function AnswerCard(props: {
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
    <Tile as="li">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{props.answer.question}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/80">
            {props.answer.answer}
          </p>
        </div>
        {props.canEdit && (
          <div className="flex">
            <button type="button" className={dsIconBtn} aria-label="Edit" onClick={props.onEdit}>
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className={dsIconBtn}
              aria-label="Remove"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash className="size-4" />
            </button>
          </div>
        )}
      </div>
    </Tile>
  );
}

function AnswerForm(props: {
  workspaceId: string;
  initial: { id?: string; question: string; answer: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState(props.initial.question);
  const [answer, setAnswer] = useState(props.initial.answer);
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
    <Tile className="mb-3 space-y-3">
      <div>
        <p className="mb-1.5 text-[13px] font-semibold">When people ask</p>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Do you deliver to Lahore?"
          maxLength={300}
          className="rounded-full"
          autoFocus
        />
      </div>
      <div>
        <p className="mb-1.5 text-[13px] font-semibold">The answer</p>
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Yes, everywhere in Pakistan in 2–3 working days. Delivery is free over Rs 3,000."
          rows={3}
          maxLength={1_500}
          className="rounded-2xl"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
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
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Tile>
  );
}
