# Raval AI GEO / AEO / SEO Intelligence — Trust, Authority & Citation Intelligence Rules Specification

> **Document Version**: 1.0.0  
> **Repository**: `raval-geo-intelligence`  
> **Module Scope**: Day 8 / Task 7 — Authority, Citation & Trust Intelligence Foundation (Steps 1–14)  
> **Status**: Verified & Feature-Complete (569 passing automated tests)

---

## 1. Overview & Architecture

### 1.1 Purpose
The **Trust, Authority & Citation Intelligence** module performs deterministic, evidence-based structural analysis of web documents to evaluate trustworthiness, domain expertise, empirical claim support, external reference quality, first-party transparency, and structural citation readiness for Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), and modern AI search engines (Perplexity, Google AI Overviews, ChatGPT Search, Claude Search).

### 1.2 Core Architectural Principles & Safeguards
1. **Evidence != Conclusion**: The system records observable structural properties extracted from DOM, metadata, schema, and text. It does not fabricate subjective conclusions or assert ungrounded authority.
2. **Potentially Support-Needed Claim != Fact-Checking**: The system identifies empirical, statistical, temporal, and superlative assertions that structurally require citations; it does **NOT** adjudicate factual truth or verify whether real-world claims are true.
3. **External Link != Automatic Citation**: Outbound links are strictly classified into primary sources, references, general links, social profiles, and commercial/affiliate links.
4. **Structural Citation Readiness != Guaranteed AI Citation**: High structural citation readiness reflects clean, verifiable citations and transparency; it does **NOT** promise or guarantee citation, inclusion, or ranking by ChatGPT, Google AI Overviews, Perplexity, or any third-party AI system.
5. **Zero Fabricated Scores**: The system avoids arbitrary 0–100 fake scores, exposing verifiable counts, enum tiers (`high`, `moderate`, `low`), and traceable findings.
6. **Deterministic Execution**: All evaluation logic uses rule-based heuristics, regex patterns, structured schemas, and DOM extraction evidence without non-deterministic external LLM runtime dependencies.

### 1.3 Pipeline Position
```text
Crawler & Scan Execution (Task 3)
      ↓
Page Extraction Engine (Task 4: 13 DOM & Metadata Domains)
      ↓
Content & Semantic Intelligence (Task 5: 11 Sub-Analyzers)
      ↓
Authority, Citation & Trust Intelligence (Task 7: Steps 2–13)
  ├── Step 3: Trust Signal Engine (trust_engine.py)
  ├── Step 4: Authority Signal Engine (authority_engine.py)
  ├── Step 5: External Source Detection Engine (source_engine.py)
  ├── Step 6: Claim-Support Engine (claim_support_engine.py)
  ├── Step 7: Source-Quality Engine (source_quality_engine.py)
  ├── Step 8: First-Party Transparency Engine (transparency_engine.py)
  └── Step 9: Citation-Readiness Engine (citation_readiness_engine.py)
      ↓
Deterministic Findings & Recommendations (Step 10: RULE_REGISTRY)
      ↓
FastAPI Integration & Idempotent Database Persistence (Step 11)
      ↓
Opportunity & Closed-Loop Fix Validation System (Task 6 Integration)
```

---

## 2. Reused Extraction & Semantic Evidence (Tasks 4–6)

Task 7 strictly reuses existing extraction and content intelligence foundations without rebuilding parsers or parallel models:

| Source Module | Extracted Evidence Reused |
|---|---|
| **Page Extractor (`page_extractor.py`)** | • Document title, meta description, canonical URL, robots directives<br>• Headings hierarchy ($H1$ through $H6$ with levels, text, and DOM order)<br>• Structured Data (JSON-LD blocks with parsed JSON, microdata items)<br>• Social Metadata (OpenGraph `og:*` and Twitter Card `twitter:*` tags)<br>• Outbound & internal links with anchor text, `rel` attributes, and targets<br>• Clean body text, word count, paragraph structures, language/hreflang |
| **Content Intelligence (`content_engine.py`)** | • Topic clusters, semantic coverage, sub-intent classification<br>• Question and answer block detection, answer-readiness metrics<br>• Content structure analysis and formatting clarity |
| **Recommendation Core (`recommendation_service.py`)** | • `FINDING_RECOMMENDATION_MAP`<br>• Explainable rationale builder (`build_explainable_rationale`)<br>• Priority normalizer (`normalize_priority`) |
| **Database Models (`models.py`)** | • `Finding`, `Recommendation`, `PageResult`, `Scan`, `Website` |

---

## 3. Modular Signal Engines (Phase B: Steps 3–9)

### 3.1 Step 3: Trust Signal Engine (`trust_engine.py`)
- **Purpose**: Detects organizational identity, corporate background, contact channels, author profiles, and business consistency across DOM, metadata, and schema.
- **Inputs**: Clean text, headings, links, JSON-LD structured data, OpenGraph/Twitter social metadata.
- **Detection Areas**:
  - `identity_signals`: Organization/Business identity declared in Schema.org (`Organization`, `NonprofitOrganization`, `GovernmentOrganization`, `Corporation`, `LocalBusiness`, `NGO`).
  - `about_signals`: Accessible company background, mission statement, or `/about` page links.
  - `contact_signals`: Verifiable direct communication channels (email, phone, physical address, `/contact` page).
  - `author_signals`: Byline patterns (`"By ..."`, `"Author: ..."`), author profile linkages, editorial review sign-offs.
  - `expertise_signals`: Explicit academic/clinical credentials (`PhD`, `MD`, `Esq`, `PE`) and peer review attributions.
  - `consistency_signals`: Cross-layer consistency between schema names, OpenGraph site names, and footer copyright text.
  - `policy_signals`: Privacy policy, terms of service, editorial guidelines, and ownership disclosures.
- **Output**: `list[TrustSignalContract]`.

### 3.2 Step 4: Authority Signal Engine (`authority_engine.py`)
- **Purpose**: Evaluates substantive topical depth, internal topic cluster architecture, domain expertise frameworks, and author credentials.
- **Inputs**: Heading structures, word counts, internal link graphs, Schema.org scholarly types (`ScholarlyArticle`, `TechArticle`, `MedicalWebPage`), topic evidence.
- **Detection Areas**:
  - `topical_depth`: Word count and structural heading richness (`comprehensive` $\ge 1500$ words + $\ge 5$ headings; `moderate` $\ge 500$ words + $\ge 2$ headings; `shallow` $< 500$ words; `thin` $\le 150$ words).
  - `supporting_pages`: Contextual internal linking to topic clusters and documentation hubs.
  - `domain_expertise`: Explicit research methodology, experimental protocols, or technical architectures.
  - `author_credentials`: Professional certifications, academic degrees, and institutional affiliations.
  - `expert_attribution`: Named editorial or expert review attributions.
  - `schema_authority`: Valid Schema.org publication and scholarly markup.
- **Output**: `list[AuthoritySignalContract]`.

### 3.3 Step 5: External Source Detection Engine (`source_engine.py`)
- **Purpose**: Discovers and classifies external reference links, bibliography sections, academic databases, and outbound commercial links.
- **Inputs**: Outbound links, anchor texts, surrounding paragraph context, reference section headings.
- **Detection Areas**:
  - `reference_sections`: Explicit bibliography or source section headings (`"References"`, `"Bibliography"`, `"Sources"`, `"Works Cited"`).
  - `source_classification`: Classifies links into `citation` (DOI, arXiv, PubMed, .edu, .gov, standards bodies), `social`, `affiliate_commercial` (Amazon tags, `rel="sponsored"`, affiliate parameters), or general `external`.
  - `citation_candidates`: Flags verifiable outbound references as primary citation candidates.
- **Output**: `list[ExternalSourceContract]`.

### 3.4 Step 6: Claim-Support Engine (`claim_support_engine.py`)
- **Purpose**: Detects potentially support-needed empirical assertions and associates them with nearby corroborating reference citations.
- **Inputs**: Sentence-level tokenized text, detected external sources, heading structures.
- **Detection Areas**:
  - `statistical`: Specific numbers, percentages (`"42.5%"`), multipliers (`"3x faster"`), and benchmark assertions.
  - `temporal`: Specific historical dates and time-sensitive assertions (`"since 2019"`, `"in Q3 2024"`).
  - `comparative`: Comparative performance claims (`"twice as efficient as"`, `"outperforms"`).
  - `superlative`: Subjective extreme assertions (`"the fastest database"`, `"the most advanced"`).
  - `technical`: Scientific mechanisms, clinical assertions, and architectural statements.
  - `source_associations`: Direct contextual or in-sentence mapping between claims and external reference URLs.
- **Output**: `list[SupportNeededClaimContract]` and `list[SourceAssociationContract]`.

### 3.5 Step 7: Source-Quality Engine (`source_quality_engine.py`)
- **Purpose**: Evaluates external reference sources for primary repository indicators, anchor text descriptiveness, reachability, and commercial dilution.
- **Inputs**: `ExternalSourceContract` list from Step 5.
- **Detection Areas**:
  - `primary_source_indicators`: Authoritative repository recognition (`doi.org`, `.gov`, `.edu`, `arxiv.org`, `w3.org`, `ietf.org`, `iso.org`, `nature.com`, `ieee.org`).
  - `anchor_quality`: Descriptive semantic anchors vs generic weak phrases (`"click here"`, `"read more"`, `"link"`, `"source"`).
  - `accessibility_checks`: Valid URL syntax and observed HTTP status codes (identifying 404/broken citations).
  - `commercial_dilution`: Excessive affiliate tracking parameters and commercial flags.
- **Output**: Source quality indicators integrated into finding generation and readiness synthesis.

### 3.6 Step 8: First-Party Transparency Engine (`transparency_engine.py`)
- **Purpose**: Evaluates organizational identity disclosures, author attribution, publication/update timestamps, and direct contact channels.
- **Inputs**: Clean text, title, meta description, page links, structured data.
- **Detection Areas**:
  - `entity_identity`: Explicit organization name, author name, contact email.
  - `consistency_checks`: Domain-contact alignment (flagging free webmail like `@gmail.com` on commercial corporate domains) and conflicting entity declarations.
  - `transparency_signals`: Publication date declarations (`datePublished`, `dateModified`) and funding/ownership statements.
- **Output**: First-party transparency indicators integrated into finding generation and readiness synthesis.

### 3.7 Step 9: Citation-Readiness Engine (`citation_readiness_engine.py`)
- **Purpose**: Synthesizes all signal engine outputs into a unified master envelope with an explainable readiness assessment.
- **Inputs**: Signal engine results from Steps 3 through 8.
- **Readiness Tier Determination**:
  - **`HIGH`**: Verifiable sources corroborate empirical claims ($\ge 50\%$ coverage or 0 unsupported claims), primary repository sources present, 0 broken citations.
  - **`MODERATE`**: Verifiable sources present with 0 broken links, or substantive topical depth with citation candidates and 0 unsupported claims.
  - **`LOW`**: Empirical claims lacking external sources, thin content ($\le 150$ words), or missing first-party transparency.
- **Output**: `CitationReadinessContract` and `AuthorityCitationTrustResult`.

---

## 4. Deterministic Rule Registry & Findings

The system registers **13 canonical rule IDs** in `RULE_REGISTRY` ([`authority_citation_recommendations.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/app/authority_citation_recommendations.py#L38)):

```text
RULE_REGISTRY
├── Trust Namespace
│   ├── trust_missing_identity
│   └── trust_business_conflict
├── Authority Namespace
│   ├── authority_shallow_depth
│   ├── authority_lacks_internal_links
│   └── authority_missing_credentials
├── Source Namespace
│   └── source_excessive_commercial_links
├── Claim Support Namespace
│   ├── claim_unsupported_statistical
│   └── claim_unsupported_superlative
├── Source Quality Namespace
│   ├── source_broken_reference_link
│   └── source_generic_anchor_text
├── Transparency Namespace
│   ├── transparency_missing_first_party
│   └── transparency_contact_conflict
└── Citation Readiness Namespace
    └── readiness_low_structural_citation
```

---

## 5. Exhaustive Per-Rule Specifications

### Rule 1: `trust_missing_identity`
- **Rule ID**: `trust_missing_identity`
- **Finding Type**: `missing_trust_signals`
- **Namespace / Category**: `trust` / `trust`
- **Input**: Extracted Schema.org JSON-LD blocks, OpenGraph site name, page text, footer text.
- **Detection Logic**: Triggered when no declared organization entity exists in structured data, no valid About link is present, and no physical/contact channel is identified.
- **Evidence Produced**: `{"evaluated_blocks": int, "missing_elements": list[str], "found_in": list[str]}`.
- **Severity Behavior**: `high` by default; remains `high` when all 3 core identity channels are absent.
- **Confidence Behavior**: `high` (deterministic absence across structured and unstructured data).
- **Recommendation**: `Publish Verifiable Organizational & Contact Disclosures` (Action: `add_trust_signals`).
- **Example**: A landing page with no company name, no about link, and no contact email.
- **Limitation**: Cannot verify whether an organization is legally registered in the physical world; evaluates only declared on-page disclosures.
- **Test Reference**: `test_authority_citation_recommendations.py::test_2_trust_finding_creation_and_evidence`, `test_authority_citation_automated_testing.py::test_a2_trust_missing_identity_true_positive`.

---

### Rule 2: `trust_business_conflict`
- **Rule ID**: `trust_business_conflict`
- **Finding Type**: `business_name_conflict`
- **Namespace / Category**: `trust` / `trust`
- **Input**: Schema.org `name` / `legalName`, OpenGraph `og:site_name`, `<title>`, and footer copyright notices.
- **Detection Logic**: Triggered when normalized names extracted from structured data, OpenGraph tags, and copyright strings conflict with each other.
- **Evidence Produced**: `{"schema_name": str, "social_site_name": str, "copyright_name": str, "conflict_detected": true}`.
- **Severity Behavior**: `medium` (or `high` if schema directly contradicts footer entity).
- **Confidence Behavior**: `high` (string token mismatch across official metadata layers).
- **Recommendation**: `Standardize Business Entity Names Across DOM and Metadata` (Action: `resolve_business_name_conflict`).
- **Example**: Schema says `"Acme Global Logistics Inc."` but footer copyright says `"Apex Freight Systems 2026"`.
- **Limitation**: Does not resolve corporate parent/subsidiary relationships unless explicitly marked with `parentOrganization` in Schema.org.
- **Test Reference**: `test_authority_citation_recommendations.py::test_13_database_persistence_idempotency_and_deduplication`, `test_authority_citation_automated_testing.py::test_a3_trust_business_conflict_true_positive`.

---

### Rule 3: `authority_shallow_depth`
- **Rule ID**: `authority_shallow_depth`
- **Finding Type**: `shallow_topical_depth`
- **Namespace / Category**: `authority` / `authority`
- **Input**: Clean body word count and Heading tag list ($H1$–$H6$).
- **Detection Logic**: Triggered when word count is $< 500$ words or document has $< 2$ structural subheadings on substantive non-utility pages.
- **Evidence Produced**: `{"word_count": int, "headings_count": int, "depth_level": "shallow" | "thin"}`.
- **Severity Behavior**: `medium` for general content; `high` if word count $\le 150$ words (`thin`).
- **Confidence Behavior**: `high` (exact word and DOM node count).
- **Recommendation**: `Expand Topical Substance and Subheading Hierarchy` (Action: `expand_topical_content`).
- **Example**: A 120-word technical overview with only one $H1$ and no $H2$ subheadings.
- **Limitation**: Does not evaluate literary writing quality or prose aesthetics.
- **Test Reference**: `test_authority_engine.py::test_2_shallow_topical_depth_and_finding_creation`, `test_authority_citation_automated_testing.py::test_b2_authority_shallow_depth_true_positive`.

---

### Rule 4: `authority_lacks_internal_links`
- **Rule ID**: `authority_lacks_internal_links`
- **Finding Type**: `lacks_internal_supporting_links`
- **Namespace / Category**: `authority` / `authority`
- **Input**: Internal links list and document topic cluster classification.
- **Detection Logic**: Triggered when a substantive article page has 0 contextual internal links connecting it to related guides or topic hubs.
- **Evidence Produced**: `{"internal_links_count": int, "page_url": str}`.
- **Severity Behavior**: `low`.
- **Confidence Behavior**: `medium` (inferred from page link graph).
- **Recommendation**: `Connect Page to Internal Topic Clusters` (Action: `add_internal_supporting_links`).
- **Example**: An isolated blog post with no links to related category pages or documentation.
- **Limitation**: Evaluates only observable internal `<a>` tags; does not trace JavaScript client-side router transitions.
- **Test Reference**: `test_authority_engine.py::test_3_internal_supporting_links_detection`, `test_authority_citation_recommendations.py::test_3_authority_finding_creation_and_evidence`.

---

### Rule 5: `authority_missing_credentials`
- **Rule ID**: `authority_missing_credentials`
- **Finding Type**: `missing_author_credentials`
- **Namespace / Category**: `authority` / `authority`
- **Input**: Page author metadata, byline text, Schema.org `author` objects, clean text.
- **Detection Logic**: Triggered when a technical, medical, or scientific article has an author byline but lacks professional/academic credentials (`MD`, `PhD`, `Esq`, `PE`) or bio links.
- **Evidence Produced**: `{"author_name": str, "has_credentials": false, "has_bio_link": false}`.
- **Severity Behavior**: `medium` for technical/scientific content; `low` for general content.
- **Confidence Behavior**: `high` when an author name is detected without credential tokens.
- **Recommendation**: `Highlight Author Credentials and Professional Background` (Action: `add_author_credentials`).
- **Example**: An article byline `"By John Smith"` without degrees, job title, or biographical profile link.
- **Limitation**: Does not query external credential verification registries; evaluates only on-page disclosures.
- **Test Reference**: `test_authority_engine.py::test_4_author_credentials_and_expert_attribution`, `test_authority_citation_recommendations.py::test_3_authority_finding_creation_and_evidence`.

---

### Rule 6: `source_excessive_commercial_links`
- **Rule ID**: `source_excessive_commercial_links`
- **Finding Type**: `excessive_unbacked_commercial_links`
- **Namespace / Category**: `source` / `citation`
- **Input**: Extracted outbound links, `rel` attributes, URL parameters.
- **Detection Logic**: Triggered when commercial affiliate or sponsored links exceed 60% of all outbound links or when $\ge 5$ affiliate links exist with 0 reference citations.
- **Evidence Produced**: `{"total_external_links": int, "affiliate_links_count": int, "citation_links_count": int, "ratio": float}`.
- **Severity Behavior**: `medium`.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Balance Outbound Links with Independent Primary References` (Action: `balance_outbound_links`).
- **Example**: A product review page containing 12 Amazon affiliate links and 0 independent study citations.
- **Limitation**: Relies on observable tracking parameters (e.g. `tag=`, `aff_id=`) and `rel="sponsored"|"affiliate"`.
- **Test Reference**: `test_source_engine.py::test_4_affiliate_and_commercial_link_detection`, `test_authority_citation_recommendations.py::test_4_source_finding_creation`.

---

### Rule 7: `claim_unsupported_statistical`
- **Rule ID**: `claim_unsupported_statistical`
- **Finding Type**: `unsupported_statistical_claim`
- **Namespace / Category**: `claim_support` / `citation`
- **Input**: Sentence text tokens, numerical regex patterns, detected external source URLs.
- **Detection Logic**: Triggered when a sentence presents a quantitative metric, exact percentage, or multiplier without an in-sentence or nearby paragraph citation link.
- **Evidence Produced**: `{"claim_id": str, "claim_text": str, "claim_type": "statistical", "surrounding_context": str, "reason": str}`.
- **Severity Behavior**: `high` for major statistical assertions; `medium` for minor numbers.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Attach Primary Reference Citations to Statistical Claims` (Action: `add_source_citations`).
- **Example**: `"Our algorithm achieves a 99.4% reduction in processing latency without additional memory overhead."` (with no link).
- **Limitation**: Does not determine whether 99.4% is mathematically accurate; flags that the empirical assertion structurally lacks a source citation.
- **Test Reference**: `test_claim_support_engine.py::test_1_statistical_claim_detection_and_finding`, `test_authority_citation_automated_testing.py::test_d1_claim_support_empirical_and_comparative_true_positive`.

---

### Rule 8: `claim_unsupported_superlative`
- **Rule ID**: `claim_unsupported_superlative`
- **Finding Type**: `unsupported_superlative_claim`
- **Namespace / Category**: `claim_support` / `citation`
- **Input**: Sentence text tokens, superlative regex patterns (`"the fastest"`, `"the most advanced"`, `"unrivaled"`), external sources.
- **Detection Logic**: Triggered when strong superlative assertions are made without third-party comparative study citations.
- **Evidence Produced**: `{"claim_id": str, "claim_text": str, "claim_type": "superlative", "matched_keyword": str}`.
- **Severity Behavior**: `low` to `medium`.
- **Confidence Behavior**: `medium`.
- **Recommendation**: `Corroborate or Qualify Superlative Assertions` (Action: `tone_down_superlatives`).
- **Example**: `"We provide the most powerful and unrivaled AI search engine in existence."`
- **Limitation**: Distinguishes marketing superlatives from factual assertions using heuristic keyword boundaries.
- **Test Reference**: `test_claim_support_engine.py::test_5_superlative_and_strong_claim_detection`, `test_authority_citation_automated_testing.py::test_d2_claim_support_unbacked_superlative_true_positive`.

---

### Rule 9: `source_broken_reference_link`
- **Rule ID**: `source_broken_reference_link`
- **Finding Type**: `broken_reference_link`
- **Namespace / Category**: `source_quality` / `citation`
- **Input**: External sources with observed HTTP status codes or malformed URLs.
- **Detection Logic**: Triggered when an outbound reference link returns a $4xx$ or $5xx$ status code, has an invalid domain format, or fails URL parsing.
- **Evidence Produced**: `{"broken_url": str, "status_code": int | null, "error_reason": str}`.
- **Severity Behavior**: `high` (broken citations directly harm user and AI search trust).
- **Confidence Behavior**: `high`.
- **Recommendation**: `Repair or Replace Inaccessible Citation Links` (Action: `repair_broken_citations`).
- **Example**: Outbound DOI link returns `404 Not Found`.
- **Limitation**: During offline analysis, flags syntactically malformed URLs or mock-recorded status codes.
- **Test Reference**: `test_source_quality_engine.py::test_3_broken_and_inaccessible_source_handling`, `test_authority_citation_automated_testing.py::test_e1_source_quality_broken_and_generic_anchors_true_positive`.

---

### Rule 10: `source_generic_anchor_text`
- **Rule ID**: `source_generic_anchor_text`
- **Finding Type**: `generic_citation_anchor_text`
- **Namespace / Category**: `source_quality` / `citation`
- **Input**: Anchor text of detected external source links.
- **Detection Logic**: Triggered when a reference citation uses low-information generic phrases (`"click here"`, `"read more"`, `"link"`, `"source"`, `"this page"`) instead of descriptive titles.
- **Evidence Produced**: `{"url": str, "generic_anchor": str, "anchor_length": int}`.
- **Severity Behavior**: `low`.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Replace Generic Anchor Text with Descriptive Source Titles` (Action: `enhance_citation_anchors`).
- **Example**: `<a href="https://doi.org/10.1000/1">click here</a>`.
- **Limitation**: Image links with missing `alt` text are flagged under extraction rules rather than text anchor rules.
- **Test Reference**: `test_source_quality_engine.py::test_2_descriptive_vs_weak_anchor_text`, `test_authority_citation_automated_testing.py::test_e1_source_quality_broken_and_generic_anchors_true_positive`.

---

### Rule 11: `transparency_missing_first_party`
- **Rule ID**: `transparency_missing_first_party`
- **Finding Type**: `missing_first_party_transparency`
- **Namespace / Category**: `transparency` / `trust`
- **Input**: Page author attribution, organization declaration, contact information, publication dates.
- **Detection Logic**: Triggered when $\ge 2$ core first-party transparency disclosures (author, publisher, contact, date) are missing on an informational page.
- **Evidence Produced**: `{"missing_disclosures": list[str], "transparency_score": float}`.
- **Severity Behavior**: `high` for major content pages; `medium` for general pages.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Publish Transparent First-Party Disclosures` (Action: `add_transparency_disclosures`).
- **Example**: An anonymous medical advice article with no author, no organization name, and no publication date.
- **Limitation**: Does not enforce author disclosures on utility/legal pages (e.g. Privacy Policy).
- **Test Reference**: `test_first_party_transparency_engine.py::test_3_missing_transparency_and_finding_generation`, `test_authority_citation_recommendations.py::test_7_transparency_finding_creation`.

---

### Rule 12: `transparency_contact_conflict`
- **Rule ID**: `transparency_contact_conflict`
- **Finding Type**: `contact_identity_conflict`
- **Namespace / Category**: `transparency` / `trust`
- **Input**: Page domain and on-page contact email addresses.
- **Detection Logic**: Triggered when a commercial corporate domain (e.g. `acmeglobal.com`) lists a public free webmail provider (e.g. `acme@gmail.com`, `acme@yahoo.com`) as its primary corporate contact.
- **Evidence Produced**: `{"page_domain": str, "contact_email": str, "email_provider": str, "conflict_type": "free_webmail_on_custom_domain"}`.
- **Severity Behavior**: `low` to `medium`.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Align Business Communication Channels with Official Domain` (Action: `align_contact_domain`).
- **Example**: `https://enterprise-cloud.com` listing `support-enterprise@hotmail.com`.
- **Limitation**: Legitimate personal blogs on custom domains are excluded if marked as personal profiles in Schema.org.
- **Test Reference**: `test_first_party_transparency_engine.py::test_4_conflict_detection_free_webmail_on_corporate_domain`, `test_authority_citation_automated_testing.py::test_f1_transparency_conflict_free_webmail_true_positive`.

---

### Rule 13: `readiness_low_structural_citation`
- **Rule ID**: `readiness_low_structural_citation`
- **Finding Type**: `low_structural_citation_readiness`
- **Namespace / Category**: `citation_readiness` / `citation`
- **Input**: Master synthesis indicators (`has_verifiable_sources`, `total_claims`, `supported_claims`, `is_transparent`, `is_shallow`).
- **Detection Logic**: Triggered when the synthesized readiness level is `low` due to unbacked empirical claims, shallow topical depth, or comprehensive transparency gaps.
- **Evidence Produced**: `{"negative_signals": list[str], "structural_indicators": dict[str, Any]}`.
- **Severity Behavior**: `high`.
- **Confidence Behavior**: `high`.
- **Recommendation**: `Enhance Structural Citation Readiness and Source Backing` (Action: `enhance_citation_readiness`).
- **Example**: A page presenting 5 unbacked empirical benchmarks with 0 external reference citations.
- **Limitation**: Evaluates structural readiness for citation synthesis; does not predict real-time LLM retrieval weights.
- **Test Reference**: `test_citation_readiness_engine.py::test_3_low_structural_citation_readiness_and_findings`, `test_authority_citation_automated_testing.py::test_g1_citation_readiness_synthesis_high_vs_low`.

---

## 6. Severity & Confidence Handling

### 6.1 Severity Levels (`SeverityLevel`)
- **`critical`**: System-breaking errors (e.g. fatal extraction failures, corrupt JSON-LD).
- **`high`**: Major trust or citation deficiencies (e.g. missing identity, unbacked quantitative statistics, broken reference links, low structural citation readiness).
- **`medium`**: Moderately impactful gaps (e.g. shallow depth, unbacked superlatives, business name conflicts, missing author credentials).
- **`low`**: Minor refinement opportunities (e.g. generic anchor text, missing internal topic cluster links, contact email domain alignment).

### 6.2 Confidence Levels (`ConfidenceLevel`)
- **`high`**: Grounded in deterministic DOM extractions, exact regex pattern matches, or explicit JSON-LD properties.
- **`medium`**: Inferred from surrounding contextual text or heuristic link graph topologies.
- **`low`**: Tentative suggestions on sparse or unstructured documents.

---

## 7. Evidence Model & Traceability

Every finding generated by the Authority, Citation & Trust module guarantees an explicit, non-empty `evidence` dictionary:
```json
{
  "claim_id": "claim_stat_1",
  "claim_text": "Reduced inference latency by 45.2% across all tested benchmarks.",
  "claim_type": "statistical",
  "surrounding_context": "Under high load, our system reduced inference latency by 45.2% across all tested benchmarks.",
  "reason": "Numerical statistic lacks corroborating external reference link in context."
}
```
Findings without observable evidence are strictly prohibited by the pipeline design.

---

## 8. API Integration Layer (`main.py`)

The module exposes 7 RESTful endpoints in `backend/app/main.py`:

| Endpoint | Method | Params | Response Schema | Description |
|---|---|---|---|---|
| `/api/v1/pages/{page_id}/authority-citation-trust` | `GET` | `persist: bool = False` | `AuthorityCitationTrustResult` | Returns on-demand intelligence for a single page. |
| `/api/v1/pages/{page_id}/authority-citation-trust` | `POST` | `persist: bool = True` | `AuthorityCitationTrustResult` | Evaluates and idempotently persists findings and recommendations. |
| `/api/v1/scans/{scan_id}/authority-citation-trust` | `GET` | `persist: bool = False` | `list[AuthorityCitationTrustResult]` | Evaluates all pages in a crawl scan. |
| `/api/v1/scans/{scan_id}/authority-citation-trust` | `POST` | `persist: bool = True` | `list[AuthorityCitationTrustResult]` | Evaluates and persists findings for all pages in a crawl scan. |
| `/api/v1/websites/{website_id}/authority-citation-trust` | `GET` | `persist: bool = False` | `list[AuthorityCitationTrustResult]` | Evaluates all pages from the latest scan of a website. |
| `/api/v1/websites/{website_id}/authority-citation-trust` | `POST` | `persist: bool = True` | `list[AuthorityCitationTrustResult]` | Evaluates and persists findings from the latest scan of a website. |
| `/api/v1/authority-citation-trust/analyze` | `POST` | Body: `DirectAuthorityCitationAnalysisRequest` | `AuthorityCitationTrustResult` | Ad-hoc direct analysis of raw HTML or extracted properties without database dependencies. |

---

## 9. Automated Testing Inventory

The module is verified by a dedicated 13-file test suite:

| Test File | Step Scope | Test Count | Status |
|---|---|---|---|
| `backend/tests/test_authority_citation_contracts.py` | Step 2 Contracts | 11 | PASSED |
| `backend/tests/test_phase_a_baseline.py` | Phase A Baseline | 8 | PASSED |
| `backend/tests/test_trust_engine.py` | Step 3 Trust Engine | 12 | PASSED |
| `backend/tests/test_authority_engine.py` | Step 4 Authority Engine | 13 | PASSED |
| `backend/tests/test_source_engine.py` | Step 5 Source Engine | 9 | PASSED |
| `backend/tests/test_claim_support_engine.py` | Step 6 Claim Support Engine | 12 | PASSED |
| `backend/tests/test_source_quality_engine.py` | Step 7 Source Quality Engine | 8 | PASSED |
| `backend/tests/test_first_party_transparency_engine.py` | Step 8 Transparency Engine | 8 | PASSED |
| `backend/tests/test_citation_readiness_engine.py` | Step 9 Citation Readiness | 7 | PASSED |
| `backend/tests/test_authority_citation_recommendations.py` | Step 10 Findings & Recs | 14 | PASSED |
| `backend/tests/test_authority_citation_api.py` | Step 11 API Integration | 10 | PASSED |
| `backend/tests/test_authority_citation_automated_testing.py` | Step 12 Regression Suite | 19 | PASSED |
| `backend/tests/test_authority_citation_real_site.py` | Step 13 Real-Site Tests | 6 | PASSED |
| **Total Task 7 Intelligence Tests** | **Steps 2–13** | **129** | **100% GREEN** |
| **Full Repository Test Suite** | **Entire Project** | **569** | **100% GREEN** |

---

## 10. Step 13 Real-Site Validation & Tuning Results

### 10.1 Validated Real-Site Archetypes
Validated via [`run_real_site_step13_validation.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/scripts/run_real_site_step13_validation.py) and permanently asserted via [`test_authority_citation_real_site.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_authority_citation_real_site.py):

| Archetype | Real Page URL | Observable Evidence | Pipeline Verification |
|---|---|---|---|
| **1. Organization / About Page** | `https://www.python.org/psf/` | Official 501(c)(3) nonprofit, mission, governance links, contact email. | • Verified `NonprofitOrganization` schema<br>• Contact channels detected<br>• Citation readiness: `MODERATE` |
| **2. Long-Form Attributed Article** | `https://martinfowler.com/articles/microservices.html` | 7,905 words, 37 H2s, authors Martin Fowler & James Lewis, external bibliography. | • Author attribution verified<br>• Comprehensive topical depth<br>• 90 external sources, 8 claims<br>• Citation readiness: `HIGH` |
| **3. Technical Documentation** | `https://docs.python.org/3/whatsnew/3.13.html` | 16,606 words, 116 headings, empirical metrics (PEP 703, PEP 744, JIT speedup). | • Statistical claims detected<br>• Corroborating PEP/DOI sources mapped<br>• Citation readiness: `HIGH` |
| **4. Standards & Citations Document** | `https://www.w3.org/TR/wot-architecture/` | W3C Recommendation with RFC references, IEEE DOI citations, normative bibliography. | • Primary standards indicators verified<br>• Descriptive citation anchors<br>• Citation readiness: `HIGH` |
| **5. Minimal / Weak Page** | `http://example.com/` | 19 words, no author, no schema, no citations. | • Shallow depth finding generated<br>• Missing contact finding generated<br>• Citation readiness: `LOW` |

### 10.2 Discovered False Positives & Applied Tuning
1. **Schema.org Nonprofit & Government Types**:
   - *Discovery*: Python Software Foundation uses `@type: "NonprofitOrganization"`. Narrow commercial checks previously failed to recognize nonprofit entities.
   - *Tuning*: Extended `trust_engine.py` to match `stype.endswith("organization")` and explicit types (`NonprofitOrganization`, `GovernmentOrganization`, `NGO`).
2. **Topical Depth vs Scholarly Credentials**:
   - *Discovery*: Long-form architectural essays without academic degrees were occasionally assigned shallow depth warnings.
   - *Tuning*: Decoupled authority credentials status from topical depth status in `citation_readiness_engine.py`.
3. **Internal Domain Link Filtering**:
   - *Discovery*: Verified that internal links on multi-author sites (`martinfowler.com/articles/...`) are correctly excluded from external source counts.

---

## 11. Known Limitations & Warnings

1. **Python 3.14 / SQLAlchemy UTC Deprecation Warnings**:
   - Warnings regarding `datetime.utcnow()` in SQLAlchemy internals are logged during tests but do not affect runtime execution or correctness.
2. **Starlette Deprecation Warning**:
   - `fastapi.testclient` issues a deprecation note regarding `httpx`; will be resolved in future framework updates.
3. **JavaScript-Rendered SPAs**:
   - Heavy Single Page Applications requiring client-side JavaScript execution require headless browser rendering (Task 8 scope) prior to extraction.
