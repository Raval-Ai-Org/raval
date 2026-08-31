# Site-Level Aggregation & API Layer (Task 8 - Step 8.8)

## 1. Executive Summary

Step 8.8 establishes the **Site-Level Aggregation Engine** and **FastAPI REST Endpoints** for the Raval AI Search Intelligence backend.

The layer aggregates page-level scores, findings, and recommendations into comprehensive site-wide intelligence, identifies top score-impacting issues across the entire domain, and calculates historical progress deltas.

---

## 2. Site Aggregation Strategy

Rather than simple blind averaging, the site aggregator:
1. **Aggregates Category Scores**: Computes clean arithmetic averages of each category score across applicable pages.
2. **Computes Overall Site Score**: Calculates the canonical weighted sum across all 5 categories ($\sum \text{AvgCatScore}_c \times W_c$).
3. **Synthesizes Top Site Issues**: Ranks site-wide issues by cumulative score impact across pages and affected page frequency.
4. **Boundary Safety**: Handles zero pages safely with a clean neutral 100.0 baseline, and gracefully supports mixed N/A and UNKNOWN statuses.
5. **Historical Comparison**: Computes score delta ($\Delta$), score improvement flags, and resolved vs new issues relative to the previous scan.

---

## 3. FastAPI REST Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/scores/pages/{page_id}` | Overall score, category breakdown, point deductions, passing strengths, and explanation for a page. |
| `GET` | `/api/v1/scores/pages/{page_id}/recommendations` | Prioritized recommendations for a page classified into Quick Wins vs Deep Fixes. |
| `GET` | `/api/v1/scores/websites/{website_id}` | Aggregated site-level score summary, category summaries, top issues, and health metrics. |
| `GET` | `/api/v1/scores/websites/{website_id}/findings` | Site findings grouped by priority, category, and evaluation status. |
| `GET` | `/api/v1/scores/websites/{website_id}/recommendations` | Site-wide deduplicated recommendations with Quick Win/Deep Fix filters. |
| `GET` | `/api/v1/scores/websites/{website_id}/history` | Historical score timeline across all scans for a website. |

---

## 4. Example API Usage

```python
import requests

# 1. Fetch Page Score & Explanation
res = requests.get("http://localhost:8000/api/v1/scores/pages/42")
page_data = res.json()
print(f"Page Score: {page_data['overall_score']}/100 ({page_data['status']})")
print(f"Summary: {page_data['summary']}")

# 2. Fetch Prioritized Page Recommendations
recs = requests.get("http://localhost:8000/api/v1/scores/pages/42/recommendations").json()
print(f"Quick Wins: {recs['quick_wins_count']}, Deep Fixes: {recs['deep_fixes_count']}")

# 3. Fetch Site Score Summary
site = requests.get("http://localhost:8000/api/v1/scores/websites/1").json()
print(f"Site Score: {site['overall_site_score']}/100 ({site['site_status']})")
print(f"Top Issue #1: {site['top_issues'][0]['title']} (Impact: {site['top_issues'][0]['total_score_impact']} pts)")
```
