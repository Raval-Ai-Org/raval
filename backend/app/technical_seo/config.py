"""Configuration for the technical-SEO rule engine.

All tunables live here so severities and thresholds are not scattered as magic
constants through the rule modules (spec §9, §17: "keep thresholds/severity
configurable"). Task 4's title/meta length thresholds are intentionally *not*
duplicated — rules reuse the already-computed boolean flags
(``title_too_short``/``meta_description too_long`` etc.) so those thresholds
have a single source of truth in ``page_extractor``.
"""

# ---------------------------------------------------------------------------
# Severity model (spec §17): Critical > High > Medium > Low > Info
# ---------------------------------------------------------------------------
SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]

# Weights power the *provisional* scoring foundation (spec §20). They are
# deliberately not the final GEO/AEO score and are marked provisional in the
# API payload so the future Score -> Category -> Rule -> Evidence -> Page chain
# can replace them without breaking clients.
SEVERITY_WEIGHTS = {
    "info": 0,
    "low": 1,
    "medium": 3,
    "high": 7,
    "critical": 15,
}

SCORING_VERSION = "0.1-provisional"

# ---------------------------------------------------------------------------
# Per-rule severity overrides (single place to retune severity).
# A rule's default severity is declared at its @register call; adding an entry
# here overrides it without touching rule code.
# ---------------------------------------------------------------------------
SEVERITY_OVERRIDES: dict[str, str] = {}

# ---------------------------------------------------------------------------
# Analyzer thresholds introduced by Task 5 (not present in Task 4).
# ---------------------------------------------------------------------------
# Internal links: fewer than this many outgoing internal links (but > 0) is a
# weak-linking signal; exactly 0 is a stronger one.
FEW_INTERNAL_LINKS_THRESHOLD = 3

# The same internal destination repeated more than this many times on one page
# is flagged as potentially excessive (Info only).
EXCESSIVE_REPEAT_LINK_THRESHOLD = 20

# A canonical target shared by at least this many pages in a scan is reported
# as a shared-canonical signal (Info; legitimate for consolidation/pagination).
SHARED_CANONICAL_MIN = 3

# Pages with more than this many images get an informational count notice.
# Never used to claim a page is "slow" (spec §13) — purely a count signal.
IMAGE_COUNT_THRESHOLD = 100
