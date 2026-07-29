import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Sparkles, ArrowRight, ArrowLeft, Plus, X } from "@/components/ui/gemini-icons";

export interface ClarifyOption {
  value: string;
  label: string;
  hint?: string;
}
export interface ClarifyQuestion {
  id: string;
  label: string;
  type: "single" | "multi";
  options: ClarifyOption[];
  allowOther?: boolean;
}
export interface ClarifyPayload {
  rationale?: string;
  questions: ClarifyQuestion[];
}

interface Props {
  payload: ClarifyPayload;
  onSubmit: (answers: Record<string, string[]>) => void;
  onSkip: () => void;
  done?: boolean;
  submittedAnswers?: Record<string, string[]>;
}

export function ClarifyCard({ payload, onSubmit, onSkip, done, submittedAnswers }: Props) {
  const [answers, setAnswers] = useState<Record<string, string[]>>(submittedAnswers ?? {});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [step, setStep] = useState(() => {
    // Resume at first unanswered when reopening
    if (!submittedAnswers) return 0;
    const idx = payload.questions.findIndex((q) => !(submittedAnswers[q.id]?.length));
    return idx === -1 ? payload.questions.length - 1 : idx;
  });
  const [direction, setDirection] = useState<1 | -1>(1);

  const total = payload.questions.length;
  const isLast = step === total - 1;
  const current = payload.questions[step];
  const currentAnswered = (answers[current?.id]?.length ?? 0) > 0;
  const progress = useMemo(() => {
    const answered = payload.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;
    return Math.max((answered / total) * 100, ((step + (currentAnswered ? 1 : 0)) / total) * 100);
  }, [answers, payload.questions, total, step, currentAnswered]);

  const toggle = (q: ClarifyQuestion, value: string) => {
    if (done) return;
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single") {
        const next = { ...prev, [q.id]: cur[0] === value ? [] : [value] };
        // auto-advance for single-select
        if (cur[0] !== value) {
          setTimeout(() => {
            if (step < total - 1) {
              setDirection(1);
              setStep((s) => Math.min(s + 1, total - 1));
            }
          }, 220);
        }
        return next;
      }
      return {
        ...prev,
        [q.id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      };
    });
  };

  const addOther = (q: ClarifyQuestion) => {
    const txt = (otherText[q.id] ?? "").trim();
    if (!txt) return;
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single") return { ...prev, [q.id]: [txt] };
      return { ...prev, [q.id]: [...cur.filter((v) => v !== txt), txt] };
    });
    setOtherText((p) => ({ ...p, [q.id]: "" }));
    setOtherOpen((p) => ({ ...p, [q.id]: false }));
  };

  const goNext = () => {
    if (!currentAnswered) return;
    if (isLast) {
      onSubmit(answers);
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, total - 1));
  };
  const goBack = () => {
    if (step === 0) return;
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="ml-10 max-w-[88%] overflow-hidden rounded-2xl rounded-bl-sm border border-border bg-card/80 backdrop-blur shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)]"
    >
      {/* Header */}
      <div
        className="relative flex items-center gap-2 border-b border-border/60 px-3.5 py-2"
        style={{
          background:
            "linear-gradient(90deg, hsl(var(--aura-pink) / 0.10), hsl(var(--aura-indigo) / 0.10))",
        }}
      >
        <motion.div
          animate={{ rotate: [0, 12, -8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-3.5 w-3.5 text-aura" />
        </motion.div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Quick checks
        </span>
        {!done && (
          <span className="ml-1 text-[11px] tabular-nums text-muted-foreground/70">
            {Math.min(step + 1, total)} / {total}
          </span>
        )}
        {!done && (
          <button
            onClick={onSkip}
            className="ml-auto text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Skip all
          </button>
        )}

        {/* Progress bar */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border/40">
          <motion.div
            className="h-full origin-left"
            style={{
              background:
                "linear-gradient(90deg, hsl(var(--aura-pink)), hsl(var(--aura-indigo)))",
            }}
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="p-3.5">
        {payload.rationale && step === 0 && (
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {payload.rationale}
          </p>
        )}

        {/* Step dots */}
        {!done && total > 1 && (
          <div className="mb-3 flex items-center gap-1.5">
            {payload.questions.map((q, i) => {
              const answered = (answers[q.id]?.length ?? 0) > 0;
              const isCurrent = i === step;
              return (
                <button
                  key={q.id}
                  onClick={() => {
                    setDirection(i > step ? 1 : -1);
                    setStep(i);
                  }}
                  className="group relative h-1.5"
                  style={{ width: isCurrent ? 22 : 8 }}
                  aria-label={`Question ${i + 1}`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className={`block h-full w-full rounded-full transition-colors ${
                      isCurrent
                        ? "bg-aura"
                        : answered
                          ? "bg-aura/50"
                          : "bg-border group-hover:bg-muted-foreground/40"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* One question at a time */}
        <div className="relative min-h-[110px]">
          <AnimatePresence mode="wait" custom={direction}>
            {current && (
              <motion.div
                key={current.id}
                custom={direction}
                initial={{ opacity: 0, x: direction * 24, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: direction * -24, filter: "blur(4px)" }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="mb-2.5 text-[13.5px] font-medium leading-snug text-foreground">
                  {current.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {current.options.map((o, oi) => {
                    const active = (answers[current.id] ?? []).includes(o.value);
                    return (
                      <motion.button
                        key={o.value}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * oi + 0.08, duration: 0.22 }}
                        onClick={() => toggle(current, o.value)}
                        disabled={done}
                        title={o.hint}
                        whileTap={{ scale: 0.96 }}
                        className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-default ${
                          active
                            ? "border-transparent bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_hsl(var(--primary)/0.5)]"
                            : "border-border bg-card text-foreground hover:-translate-y-px hover:border-foreground/25 hover:bg-secondary/60"
                        }`}
                      >
                        <AnimatePresence initial={false}>
                          {active && (
                            <motion.span
                              key="check"
                              initial={{ opacity: 0, width: 0 }}
                              animate={{ opacity: 1, width: 12 }}
                              exit={{ opacity: 0, width: 0 }}
                              className="inline-flex items-center overflow-hidden"
                            >
                              <Check className="h-3 w-3" strokeWidth={2.5} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <span>{o.label}</span>
                      </motion.button>
                    );
                  })}
                  {current.allowOther && !done && (
                    <>
                      {!otherOpen[current.id] ? (
                        <button
                          onClick={() => setOtherOpen((p) => ({ ...p, [current.id]: true }))}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-[12px] text-muted-foreground transition hover:text-foreground hover:border-foreground/30"
                        >
                          <Plus className="h-3 w-3" /> Other
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5">
                          <input
                            autoFocus
                            value={otherText[current.id] ?? ""}
                            onChange={(e) =>
                              setOtherText((p) => ({ ...p, [current.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && addOther(current)}
                            placeholder="Type…"
                            className="w-32 bg-transparent px-1.5 text-[12px] outline-none"
                          />
                          <button
                            onClick={() => addOther(current)}
                            className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"
                          >
                            <Check className="h-2.5 w-2.5" />
                          </button>
                          <button
                            onClick={() => setOtherOpen((p) => ({ ...p, [current.id]: false }))}
                            className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer nav */}
        <AnimatePresence>
          {!done && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-center justify-between gap-2"
            >
              <button
                onClick={goBack}
                disabled={step === 0}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] text-muted-foreground transition hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSkip}
                  className="text-[11.5px] text-muted-foreground transition hover:text-foreground"
                >
                  Just go
                </button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={goNext}
                  disabled={!currentAnswered}
                  className="btn-aura inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium disabled:opacity-40 disabled:saturate-0"
                >
                  {isLast ? "Continue" : "Next"} <ArrowRight className="h-3 w-3" />
                </motion.button>
              </div>
            </motion.div>
          )}
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-500"
            >
              <Check className="h-3 w-3" /> Locked in — working on it
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
