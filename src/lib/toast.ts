"use client";

// The app's one toast. Same API as sonner's, with two guarantees:
//  - errors and warnings never show provider, billing or setup details
//    (see user-errors.ts);
//  - an identical message shown again while it is still up replaces itself
//    instead of stacking.
import { toast as base, type ExternalToast } from "sonner";
import { userSafeMessage } from "@/lib/user-errors";

type Title = Parameters<typeof base>[0];

function safeTitle(title: Title): Title {
  return typeof title === "string" ? userSafeMessage(title) : title;
}

function safeData(data?: ExternalToast): ExternalToast | undefined {
  if (!data) return data;
  const description =
    typeof data.description === "string" ? userSafeMessage(data.description, "") : data.description;
  return { ...data, description: description === "" ? undefined : description };
}

function withId(title: Title, data?: ExternalToast): ExternalToast | undefined {
  if (data?.id !== undefined || typeof title !== "string") return data;
  return { ...data, id: `t:${title}` };
}

function make(kind: "error" | "warning") {
  return (title: Title, data?: ExternalToast) => {
    const t = safeTitle(title);
    return base[kind](t, withId(t, safeData(data)));
  };
}

export const toast = Object.assign(
  (title: Title, data?: ExternalToast) => base(title, withId(title, data)),
  base,
  {
    error: make("error"),
    warning: make("warning"),
    success: (title: Title, data?: ExternalToast) => base.success(title, withId(title, data)),
    info: (title: Title, data?: ExternalToast) => base.info(title, withId(title, data)),
  },
);
