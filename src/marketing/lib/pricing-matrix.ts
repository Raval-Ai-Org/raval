// The plan comparison table on /pricing. Keep every row in step with src/lib/billing/catalog.ts (plans, limits and
// each feature's `minPlan`): this table must never promise more than the product gives.
import { PLANS } from "@/lib/billing/catalog";

export type Cell = string | boolean;
export type MatrixRow = { label: string; values: Cell[] };
export type MatrixGroup = { title: string; rows: MatrixRow[] };

// The column prices come from the product's own catalog, so they can't drift from what the product charges.
export const MATRIX_COLUMNS = [
  { name: "Free", price: "$0" },
  ...(["starter", "growth", "agency", "scale"] as const).map((id) => ({
    name: PLANS[id].label,
    price: `$${PLANS[id].priceMonthlyUsd.toLocaleString("en-US")} /mo`,
    ...(id === "growth" ? { highlight: true } : {}),
  })),
];

export const MATRIX: MatrixGroup[] = [
  {
    "title": "Workspace",
    "rows": [
      {
        "label": "Brand workspaces",
        "values": [
          "1",
          "1",
          "3",
          "10",
          "30"
        ]
      },
      {
        "label": "Seats",
        "values": [
          "1",
          "2",
          "5",
          "Unlimited",
          "Unlimited"
        ]
      },
      {
        "label": "Mellox credits per month",
        "values": [
          "100 one time",
          "2,000",
          "6,000",
          "18,000",
          "50,000"
        ]
      },
      {
        "label": "Video credits per month",
        "values": [
          "None",
          "4",
          "12",
          "40 pooled",
          "100 pooled"
        ]
      },
      {
        "label": "Pooled credits across brands",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      }
    ]
  },
  {
    "title": "Assistant",
    "rows": [
      {
        "label": "Mellox Flash chat, fair use",
        "values": [
          "30 messages",
          "800",
          "2,000",
          "5,000",
          "12,000"
        ]
      },
      {
        "label": "Mellox Pro chat messages",
        "values": [
          false,
          "30",
          "150",
          "400 pooled",
          "1,200 pooled"
        ]
      },
      {
        "label": "Live web research in chat",
        "values": [
          false,
          true,
          true,
          true,
          true
        ]
      }
    ]
  },
  {
    "title": "Studio",
    "rows": [
      {
        "label": "Posts, images, carousels, ads, scripts",
        "values": [
          "100 credits to try",
          true,
          true,
          true,
          true
        ]
      },
      {
        "label": "Premium GEO grounded articles",
        "values": [
          false,
          true,
          true,
          true,
          true
        ]
      },
      {
        "label": "Campaign plans",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "Approval workflows",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "Posting to every social network",
        "values": [
          "Unlimited",
          "Unlimited",
          "Unlimited",
          "Unlimited",
          "Unlimited"
        ]
      }
    ]
  },
  {
    "title": "Video",
    "rows": [
      {
        "label": "Draft and Standard video, 720p",
        "values": [
          false,
          true,
          true,
          true,
          true
        ]
      },
      {
        "label": "1080p, Premium and Long take",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "Cinematic multi shot",
        "values": [
          false,
          false,
          false,
          true,
          true
        ]
      },
      {
        "label": "Renders at the same time",
        "values": [
          false,
          "1",
          "2",
          "4",
          "8"
        ]
      }
    ]
  },
  {
    "title": "AI visibility",
    "rows": [
      {
        "label": "Tracked prompts, checked weekly",
        "values": [
          "5",
          "25",
          "100",
          "300 pooled",
          "1,000 pooled"
        ]
      },
      {
        "label": "Answer engines",
        "values": [
          "ChatGPT, Gemini",
          "+ Perplexity",
          "3 engines",
          "3 engines",
          "3 engines"
        ]
      },
      {
        "label": "Site scans per month (max pages)",
        "values": [
          "1 (25)",
          "4 (50)",
          "10 (150)",
          "30 (300)",
          "90 (500)"
        ]
      },
      {
        "label": "GEO fix proposals",
        "values": [
          "View findings",
          true,
          true,
          true,
          true
        ]
      },
      {
        "label": "CMS fixes, WordPress and Webflow",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "GEO Engineer and Fix all",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      }
    ]
  },
  {
    "title": "Intelligence",
    "rows": [
      {
        "label": "Competitors tracked",
        "values": [
          false,
          "3",
          "10",
          "30",
          "90"
        ]
      },
      {
        "label": "Market Brain updates",
        "values": [
          false,
          "Weekly, 1 brand",
          "Weekly, 3 brands",
          "Weekly, 10 brands",
          "Weekly, 30 brands"
        ]
      },
      {
        "label": "Weekly Marketing Coach briefing",
        "values": [
          false,
          "1 brand",
          "1 brand",
          "3 brands",
          "10 brands"
        ]
      },
      {
        "label": "GA4 and Search Console insights",
        "values": [
          false,
          true,
          true,
          true,
          true
        ]
      },
      {
        "label": "Test posts on your audience first",
        "values": [
          false,
          true,
          true,
          true,
          true
        ]
      }
    ]
  },
  {
    "title": "Team and agency",
    "rows": [
      {
        "label": "Client portal and share links",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "Backlinks on real, relevant sites",
        "values": [
          false,
          false,
          true,
          true,
          true
        ]
      },
      {
        "label": "Agency command center, white label",
        "values": [
          false,
          false,
          false,
          true,
          true
        ]
      },
      {
        "label": "SSO and API access",
        "values": [
          false,
          false,
          false,
          false,
          "Coming soon"
        ]
      },
      {
        "label": "Credit rollover on annual plans",
        "values": [
          false,
          "Up to 1 month",
          "Up to 1 month",
          "Up to 1 month",
          "Up to 1 month"
        ]
      }
    ]
  },
  {
    "title": "Connections and automation",
    "rows": [
      { "label": "Autopilot mode",
        "values": [
          false,
          false,
          true,
          true,
          true
        ] },
      { "label": "MCP connection (Claude and ChatGPT)", "values": [false, true, true, true, true] },
      { "label": "Slack and Notion", "values": [false, true, true, true, true] },
      { "label": "Edit generated images in Canva", "values": [false, true, true, true, true] }
    ]
  },
  {
    "title": "Support",
    "rows": [
      {
        "label": "Support level",
        "values": [
          "Community",
          "Email",
          "Email, 24 h",
          "Priority and onboarding call",
          "Dedicated manager"
        ]
      }
    ]
  }
];
