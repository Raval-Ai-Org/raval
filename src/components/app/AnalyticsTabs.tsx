import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Search,
  Share2,
  FileText,
  PieChart as PieIcon,
  Settings2,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

export type AnalyticsTab =
  "overview" | "organic" | "social" | "content" | "audience" | "automations";

export const TABS: {
  id: AnalyticsTab;
  label: string;
  icon: any;
  blurb: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    blurb: "The 30-second snapshot of everything.",
  },
  { id: "organic", label: "Organic", icon: Search, blurb: "How people find you on Google & AI." },
  { id: "social", label: "Social", icon: Share2, blurb: "Posts, reach, and what's scheduled." },
  { id: "content", label: "Content", icon: FileText, blurb: "Drafts moving toward publish." },
  { id: "audience", label: "Audience", icon: PieIcon, blurb: "Who's visiting and where from." },
  {
    id: "automations",
    label: "Automations",
    icon: Settings2,
    blurb: "Background helpers you've turned on.",
  },
];

export function AnalyticsTabs({
  value,
  onChange,
}: {
  value: AnalyticsTab;
  onChange: (t: AnalyticsTab) => void;
}) {
  const active = TABS.find((t) => t.id === value);
  return (
    <div className="sticky top-0 z-20 -mx-3 mb-4 border-b border-border/70 bg-background/85 px-3 pt-2 pb-3 backdrop-blur-xl sm:-mx-5 sm:px-5">
      <nav className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = value === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              title={t.blurb}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="analytics-tab"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 -z-10 rounded-full bg-card ring-1 ring-border/80 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_14px_-6px_hsl(var(--brand-blue)/0.35)]"
                />
              )}
              <Icon
                className={cn("h-3.5 w-3.5", isActive && "text-[hsl(var(--brand-blue))]")}
                strokeWidth={2.2}
              />
              {t.label}
            </button>
          );
        })}
      </nav>

      {active && (
        <motion.p
          key={active.id}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 pl-1 text-[11.5px] text-muted-foreground"
        >
          {active.blurb}
        </motion.p>
      )}
    </div>
  );
}
