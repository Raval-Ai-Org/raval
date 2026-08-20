# Raval AI Search Intelligence
# System Architecture

## 1. Architecture Overview

Raval AI Search Intelligence is designed as a modular intelligence platform for analyzing websites, search visibility, AI visibility, citations, competitors, opportunities, recommendations, fixes, and validation.

The architecture separates crawling, analysis, intelligence, recommendation, execution, validation, and monitoring responsibilities.

The initial architecture is:

Website
    ↓
Crawler
    ↓
Website Data
    ↓
SEO / Content / Entity Analysis
    ↓
GEO / AEO / AI Intelligence
    ↓
Analytics / Competitor Intelligence
    ↓
Unified Intelligence
    ↓
Opportunity Engine
    ↓
Fix Engine
    ↓
Validation
    ↓
Monitoring


## 2. High-Level System Flow

```text
                         ┌──────────────────┐
                         │     Frontend     │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Backend API    │
                         └────────┬─────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                 ▼                ▼                ▼
          ┌────────────┐   ┌────────────┐   ┌─────────────┐
          │ PostgreSQL │   │ Job Queue  │   │ AI Gateway  │
          └────────────┘   └──────┬─────┘   └─────────────┘
                                  │
                                  ▼
                           ┌────────────┐
                           │  Workers   │
                           └──────┬─────┘
                                  │
                                  ▼
                           ┌────────────┐
                           │  Crawler   │
                           └──────┬─────┘
                                  │
                                  ▼
                           Website Data
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
           SEO Engine       Content Engine     Entity Engine
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  ▼
                      GEO / AEO / AI Intelligence
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
          AI Benchmark      Citation Engine   Competitor Engine
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  ▼
                       Unified Intelligence
                                  │
                                  ▼
                       Opportunity Engine
                                  │
                                  ▼
                           Fix Engine
                                  │
                                  ▼
                         Validation Engine
                                  │
                                  ▼
                            Monitoring

## 3. Frontend

### Responsibility

The frontend provides the user-facing interface for the intelligence platform.

Potential responsibilities include:

- Workspace management
- Website and project management
- Crawl initiation
- Crawl status
- SEO dashboards
- GEO/AEO dashboards
- AI visibility results
- Citation analysis
- Competitor analysis
- Opportunity discovery
- Recommendations
- Fix review
- Validation results
- Monitoring and alerts

### Boundary

The frontend should communicate with the backend API rather than directly accessing the database, crawler, job workers, or AI providers.

The frontend is responsible for presentation and user interaction, while business logic and data processing remain in backend and domain-specific modules.


## 4. Backend API

### Technology

Python + FastAPI

### Responsibility

The backend API acts as the primary application orchestration layer.

It is responsible for:

- API endpoints
- Request validation
- Authentication and authorization
- Workspace-level access control
- Creating background jobs
- Reading analysis results
- Coordinating intelligence workflows
- Returning structured results to the frontend
- Managing application-level business workflows

### Boundary

The backend should not contain all crawler or intelligence implementation directly.

Domain-specific responsibilities remain inside their respective modules.

The backend should coordinate modules through defined interfaces rather than tightly coupling all business logic into a single service.


## 5. Job Queue and Workers

Long-running operations should be processed asynchronously.

Examples include:

- Website crawling
- Large website analysis
- AI benchmark execution
- Re-crawling
- Monitoring
- Scheduled analysis
- Connector synchronization

### Flow

```text
Frontend
   ↓
Backend API
   ↓
Create Job
   ↓
Job Queue
   ↓
Worker
   ↓
Execute Task
   ↓
Store Results
   ↓
Update Job Status

## 6. Crawler Layer

### Technology

Node.js + TypeScript

Crawlee + Playwright + Cheerio

### Responsibility

The crawler layer is responsible for collecting structured evidence from websites.

Its responsibilities include:

- Starting website crawls
- Discovering URLs
- Managing URL queues
- Retrieving web pages
- Handling JavaScript-rendered pages
- Parsing HTML
- Discovering internal links
- Extracting page metadata
- Extracting structured data
- Tracking crawl status
- Handling retries
- Applying crawl limits

### Rendering

Playwright is used when browser rendering is required.

This is important for websites where content is generated or modified through JavaScript.

The crawler should use browser rendering only when required so that unnecessary browser execution does not increase resource consumption.

### Parsing

Cheerio is used for lightweight HTML parsing and extraction.

Potential extraction areas include:

- Page title
- Meta description
- Headings
- Links
- Images
- Image alt text
- Canonical URLs
- Structured data
- Robots directives
- Other relevant HTML signals

### Crawl Management

Crawlee is responsible for managing crawling operations such as:

- Request queues
- URL discovery
- Crawl execution
- Retry handling
- Concurrency management
- Crawl state
- Request processing

### Important Security Boundary

Crawler input must be validated before any external request is made.

The crawler must eventually include protections against:

- SSRF
- Unsafe destinations
- Internal network access
- Excessive crawl depth
- Excessive resource usage
- Invalid URLs
- Uncontrolled request volume

### Crawl Evidence

The crawler should produce structured website evidence that can be consumed by downstream analysis engines.

The crawler should collect evidence but should not directly generate final recommendations.

### Boundary

The crawler should remain independent from:

- Frontend presentation
- Recommendation logic
- Fix execution
- AI provider-specific logic

Crawler output should be passed to the website data and analysis layers.


## 7. Website Data Layer

### Responsibility

The website data layer stores and organizes the evidence collected by the crawler.

It acts as the foundation for downstream intelligence and analysis.

### Potential Website Evidence

The data layer may contain:

- URLs
- HTTP status codes
- Response metadata
- HTML
- Rendered DOM information
- Page titles
- Meta descriptions
- Headings
- Internal links
- External links
- Images
- Alt text
- Structured data
- Canonical URLs
- Robots directives
- Page-level signals

### Evidence Storage

Website evidence should be stored in a structured form so that multiple analysis engines can consume the same evidence.

The same evidence should not need to be collected independently by each engine.

### Evidence Lineage

The system should preserve the relationship between:

```text
Website
   ↓
Crawl
   ↓
Page
   ↓
Observation
   ↓
Finding

### Data Principle

Raw website evidence and derived intelligence should remain distinguishable.

This allows downstream systems to identify:

Original evidence
Derived observations
Findings
Recommendations
Validation results
### Boundary

The website data layer should not contain presentation logic.

It should provide structured evidence to:

SEO Engine
Content Engine
Entity Engine
GEO/AEO analysis
Other intelligence modules

## 8. SEO Engine

### Responsibility

The SEO Engine analyzes website evidence for traditional search optimization signals.

The engine consumes structured website evidence collected by the Crawler and Website Data Layer and converts that evidence into structured SEO findings.

### Potential Analysis Areas

The SEO Engine may analyze:

- Technical SEO
- Page metadata
- Title tags
- Meta descriptions
- Heading structure
- Internal linking
- Canonical URLs
- Robots directives
- Structured data
- Indexability signals
- URL structure
- Page-level SEO issues
- Technical page signals

### Input

The SEO Engine consumes evidence from the Website Data Layer.

Potential inputs include:

- URLs
- HTTP status codes
- HTML
- Rendered DOM information
- Page titles
- Meta descriptions
- Headings
- Links
- Images
- Canonical URLs
- Robots directives
- Structured data

### Findings

The SEO Engine should produce structured findings.

A finding may contain:

- Issue
- Page
- Evidence
- Severity
- Impact
- Confidence
- Recommendation

### Example Flow

```text
Website Evidence
      ↓
SEO Analysis
      ↓
SEO Finding
      ↓
Evidence
      ↓
Opportunity

Output

SEO findings should be available to:

Unified Intelligence
Opportunity Engine
Recommendation workflows
Analytics
Validation
### Boundary

The SEO Engine should analyze website evidence but should not directly modify the customer's website.

Recommendations and fixes should flow through the appropriate Recommendation and Fix workflows.

The SEO Engine should not own:

Website crawling
AI provider management
Fix execution
Frontend presentation
Authentication
Data Principle

SEO findings should remain linked to their supporting website evidence.

This allows the system to determine why a particular SEO issue was detected.

Reusability

SEO findings should be reusable across:

Dashboards
Reports
Opportunity analysis
Recommendations
Validation
Monitoring

## 9. Content Engine
### Responsibility

The Content Engine evaluates website content quality and content-level signals.

It consumes website content and related evidence from the Website Data Layer and produces structured content intelligence.

### Potential Responsibilities

The Content Engine may perform:

Content extraction
Content structure analysis
Topic coverage analysis
Content completeness analysis
Question coverage analysis
Content gap detection
Content quality analysis
Readability-related analysis
Content recommendations
Input

### Potential inputs include:

Page content
Headings
Paragraphs
Lists
Questions
Structured content
Related metadata
Page-level evidence
Content Evidence

The engine should produce structured content evidence that can be reused by other intelligence modules.

###Potential content evidence may include:

Topics
Covered concepts
Missing concepts
Questions
Content gaps
Content quality signals
Supporting page evidence
AI Usage

The Content Engine may use AI through the centralized AI Gateway when AI-based analysis is required.

The Content Engine should not maintain independent provider credentials or disconnected AI integrations.

###Output

Content analysis should produce structured results that can be consumed by:

Unified Intelligence
Opportunity Engine
Recommendation workflows
Fix Engine
Validation
Analytics

###Example Flow
Website Content
      ↓
Content Extraction
      ↓
Content Analysis
      ↓
Content Findings
      ↓
Opportunity

### Boundary

The Content Engine should focus on content intelligence.

It should not duplicate:

Crawler responsibilities
Citation analysis
Competitor analysis
Authentication responsibilities
Fix execution
Data Principle

Content findings should remain connected to the page and evidence from which they were derived.

This preserves traceability between:
Page
   ↓
Content Evidence
   ↓
Content Finding
   ↓
Opportunity
   ↓
Recommendation

### Reusability

Content intelligence should be reusable across:

SEO analysis
GEO/AEO analysis
AI visibility analysis
Opportunity detection
Recommendations
Validation

## 10. Entity Engine
Responsibility

The Entity Engine analyzes entities and their relationships within website and content evidence.

It identifies meaningful entities and creates structured entity intelligence that can be reused by downstream modules.

Potential Responsibilities

The Entity Engine may perform:

Entity extraction
Entity normalization
Entity relationship detection
Organization identification
Product identification
Person identification
Place identification
Entity consistency analysis
Knowledge graph-oriented analysis
Entity evidence collection
Input

Potential inputs include:

Website content
Page metadata
Structured data
Existing entity evidence
Related pages
External entity signals where available
Entity Evidence

Entity results should be stored in structured form.

Potential entity data may include:

Entity name
Entity type
Entity relationships
Source page
Supporting evidence
Confidence

Example Flow
Website Evidence
      ↓
Entity Extraction
      ↓
Entity Normalization
      ↓
Entity Relationships
      ↓
Structured Entity Evidence
Downstream Usage

Entity intelligence may later support:

GEO/AEO analysis
AI visibility analysis
Competitor analysis
Content analysis
Recommendations
Unified Intelligence
Boundary

The Entity Engine should analyze entity information but should not directly modify customer websites.

It should not own:

Website crawling
Frontend presentation
Fix execution
AI provider credentials
External authentication
Data Principle

Entity information should remain connected to its source evidence.

The system should be able to trace an entity back to:

Source page
Supporting content
Structured data
Related observations
Reusability

Entity intelligence should be reusable across multiple intelligence workflows instead of being recreated independently by each module.

## 11. GEO / AEO / AI Intelligence Layer
Responsibility

This layer evaluates visibility in AI-generated search experiences.

It combines website evidence with AI-generated results to understand how a website, organization, product, or other entity is represented in AI search experiences.

Potential Capabilities

The layer may include:

AI benchmark questions
AI answer collection
Mention detection
Citation detection
Citation source analysis
Competitor mention detection
Entity presence analysis
Answer-level visibility
AI visibility scoring
Input

The intelligence layer may consume:
Website evidence
SEO findings
Content findings
Entity evidence
AI benchmark results
Citation data
Competitor data

Processing Flow
Website Evidence
      ↓
SEO / Content / Entity Evidence
      ↓
AI Benchmark
      ↓
AI Answers
      ↓
Mention / Citation / Competitor Detection
      ↓
AI Visibility Intelligence
Output

The layer should produce structured intelligence that can be used by:

Unified Intelligence
Opportunity Engine
Analytics
Recommendations
Monitoring
AI Provider Access

AI provider access should be handled through the centralized AI Gateway.

Individual intelligence modules should not create disconnected provider integrations.

### Boundary

AI intelligence should consume evidence from the Crawler and analysis engines.

It should not duplicate crawler functionality or create independent website collection pipelines.

The GEO/AEO/AI layer should also remain separate from:

Frontend presentation
Direct website modification
Authentication management
Provider credential management
Data Principle

AI visibility results should remain connected to the benchmark question, AI run, answer, mentions, citations, competitors, and supporting evidence that produced the result.

Reusability

AI intelligence should be reusable across:

Dashboards
Reports
Opportunity detection
Recommendations
Monitoring
Historical analytics

## 12. AI Benchmark
Responsibility

The AI Benchmark system evaluates predefined questions across supported AI and search experiences.

It provides repeatable measurement of AI visibility.

Benchmark Flow
Question
   ↓
AI Run
   ↓
Answer
   ↓
Mention Detection
   ↓
Citation Detection
   ↓
Competitor Detection
   ↓
Metrics
Benchmark Data

A benchmark result should preserve:

Benchmark question
AI run
Timestamp
AI provider
Model
Generated answer
Detected mentions
Detected citations
Detected competitors
Related metrics
Supporting evidence
Benchmark Question

Questions should represent the search or information scenarios that the system wants to evaluate.

Questions may later be grouped by:

Topic
Intent
Entity
Market
Product
Search scenario
Historical Tracking

Benchmark results should support comparison over time.

This allows the platform to identify:

Visibility improvements
Visibility declines
Mention changes
Citation changes
Competitor changes
Example Result Relationship
Benchmark Question
       ↓
AI Run
       ↓
AI Answer
       ↓
Mentions
       ↓
Citations
       ↓
Competitors
       ↓
Visibility Metrics
Output

The AI Benchmark should provide structured results to:

GEO/AEO Intelligence
Citation Engine
Competitor Engine
Analytics
Unified Intelligence
Boundary

The AI Benchmark should focus on measuring AI/search visibility.

It should not:

Modify website content
Execute fixes
Manage frontend presentation
Own crawler implementation
Data Principle

Every benchmark result should retain enough context to understand:

What question was asked
Which AI provider/model was used
When the run occurred
What answer was returned
What mentions were detected
What citations were detected
Which competitors appeared

This makes benchmark results reproducible and comparable over time.

## 13. Citation Engine
Responsibility

The Citation Engine analyzes citations and sources appearing in AI answers.

It identifies where AI answers obtain supporting sources and how frequently relevant websites or competitors are cited.

Potential Responsibilities

The Citation Engine may perform:

Citation extraction
Citation normalization
Source identification
Source classification
Citation frequency analysis
Citation quality analysis
Competitor source comparison
Citation opportunity detection
Input

The Citation Engine may consume:

AI answers
Benchmark questions
AI runs
Detected citations
Source URLs
Competitor information
Citation Relationship

Citation data should remain linked to:

Original AI answer
Benchmark question
AI run
Source URL
Related competitor information where applicable
Example Flow
AI Answer
   ↓
Citation Extraction
   ↓
Citation Normalization
   ↓
Source Analysis
   ↓
Citation Intelligence
Potential Citation Data

A citation record may include:

Source URL
Source domain
Related AI answer
Benchmark question
AI provider
Timestamp
Citation position or occurrence
Source classification
Related competitor
Supporting evidence
Output

Citation intelligence may be used by:

GEO/AEO Intelligence
Competitor Engine
Unified Intelligence
Opportunity Engine
Analytics
Monitoring
Boundary

The Citation Engine should not generate unrelated website crawl data.

It should work from available AI answer and source evidence.

It should not own:

Website crawling
Website modification
Frontend presentation
AI provider authentication
Data Principle

Citation data should preserve its relationship to the original AI answer.

This allows the system to determine:

Benchmark
   ↓
AI Run
   ↓
AI Answer
   ↓
Citation
   ↓
Source
Citation Opportunity

Citation intelligence may later be used to identify opportunities where competitors are cited but the target website is not.

## 14. Competitor Engine
Responsibility

The Competitor Engine identifies and compares competing entities and websites.

It uses website, AI, citation, and benchmark evidence to build competitor intelligence.

Potential Responsibilities

The Competitor Engine may perform:

Competitor identification
Competitor mention analysis
Competitor citation analysis
Competitor visibility analysis
Competitor content comparison
Competitor opportunity analysis
Input

Potential inputs include:

AI benchmark results
AI answers
Mentions
Citations
Website evidence
Entity evidence
Competitor observations
Competitor Intelligence

Potential competitor information may include:

Competitor name
Website
Mention frequency
Citation frequency
Visibility
Related benchmark questions
Related pages
Comparison signals
Example Flow
AI / Search Evidence
       ↓
Competitor Detection
       ↓
Competitor Analysis
       ↓
Comparison
       ↓
Competitor Opportunities
Comparison Areas

The engine may compare:

AI visibility
Mentions
Citations
Content coverage
Entity presence
Related opportunities
Output

Competitor intelligence should be available to:

Unified Intelligence
Opportunity Engine
Analytics
GEO/AEO Intelligence
Dashboards
Reports
Boundary

Competitor findings should be connected to the same benchmark and evidence model used by the rest of the intelligence system.

The Competitor Engine should not maintain an isolated intelligence model.

It should not own:

Website crawling
AI provider credentials
Direct website modification
Frontend presentation
Data Principle

Competitor observations should retain their supporting evidence.

For example:

Benchmark Question
      ↓
AI Answer
      ↓
Competitor Mention
      ↓
Competitor Entity
      ↓
Competitor Evidence

This allows competitor comparisons to remain explainable.

## 15. Analytics Layer
Responsibility

The Analytics Layer aggregates historical results from the intelligence system.

It provides trend information instead of relying only on current snapshots.

Potential Metrics

The Analytics Layer may track:

Crawl trends
SEO issue trends
AI visibility trends
Mention trends
Citation trends
Competitor trends
Opportunity trends
Validation trends
Historical Analysis

Analytics should support comparisons such as:

Current Result
      ↓
Previous Result
      ↓
Change
      ↓
Trend

Example
AI Visibility
     ↓
Historical Results
     ↓
Visibility Change
     ↓
Trend
Purpose

The Analytics Layer helps users understand how website and AI visibility change over time.

It can support:

Performance dashboards
Historical reports
Trend analysis
Visibility tracking
Competitor comparison
Opportunity prioritization
Monitoring
Input

Analytics may consume structured results from:

Crawl system
SEO Engine
Content Engine
Entity Engine
AI Benchmark
Citation Engine
Competitor Engine
Opportunity Engine
Validation Engine
Output

The Analytics Layer may produce:

Aggregated metrics
Historical trends
Comparisons
Change indicators
Performance summaries
Boundary

Analytics should consume structured results from other modules instead of duplicating their analysis logic.

It should not independently perform:

Crawling
SEO analysis
Content analysis
Entity extraction
Citation extraction
Competitor detection
Data Principle

Analytics should preserve historical results rather than overwriting previous states.

This enables comparisons such as:

Previous State
      ↓
Current State
      ↓
Difference
      ↓
Trend
Reusability

Analytics results should be reusable across:

Dashboards
Reports
Monitoring
Trend detection
Opportunity prioritization
Historical comparisons
Architectural Principle

Analytics is an aggregation and interpretation layer.

The underlying domain engines remain responsible for generating their own domain-specific findings.


## 16. Unified Intelligence Layer
Responsibility

The unified intelligence layer combines evidence from multiple analysis engines into a consistent intelligence model.

Inputs

Potential inputs include:

SEO evidence
Content evidence
Entity evidence
AI evidence
Citation evidence
Competitor evidence
Analytics
Data Combination
SEO Evidence
      +
Content Evidence
      +
Entity Evidence
      +
AI Evidence
      +
Citation Evidence
      +
Competitor Evidence
      ↓
Unified Intelligence
Purpose

The purpose is to provide one consistent evidence model for:

Recommendations
Opportunities
Fixes
Validation
Analytics
Monitoring
Evidence Lineage

Unified intelligence should preserve relationships back to the original evidence.

For example:

Website Page
    ↓
Observation
    ↓
Finding
    ↓
Opportunity
    ↓
Recommendation
Architectural Principle

This layer should avoid creating duplicate or disconnected intelligence pipelines.

Different engines should contribute evidence to a shared intelligence model rather than creating isolated result systems.

## 17. Opportunity Engine
Responsibility

The opportunity engine converts evidence and findings into prioritized opportunities.

Opportunity Structure

An opportunity may contain:

Problem
Evidence
Impact
Confidence
Priority
Recommended action
Related pages
Related entities
Related competitors
Prioritization

The engine should prioritize opportunities instead of simply listing raw issues.

Potential prioritization factors include:

Impact
Confidence
Effort
Business relevance
Visibility potential
Example Flow
Evidence
   ↓
Finding
   ↓
Opportunity Detection
   ↓
Priority
   ↓
Recommended Action
Output

Opportunities should be structured so they can be:

Displayed in dashboards
Included in reports
Passed to recommendation workflows
Passed to fix workflows
Validated later
Boundary

The opportunity engine should not directly execute fixes.

## 18. Fix Engine
Responsibility

The fix engine generates structured recommendations or proposed changes based on validated opportunities.

Potential Outputs

The fix engine may generate:

Metadata changes
Content improvements
Structured data changes
Internal linking suggestions
Entity-related improvements
AI visibility improvements
Fix Proposal

A fix proposal should explain:

What should change
Why it should change
What evidence supports the change
What expected result should be
Which page or entity is affected
Safety Boundary

The fix engine should not automatically execute destructive changes without:

Explicit authorization
Validation
Appropriate permissions
Safety checks
Example Flow
Opportunity
     ↓
Recommendation
     ↓
Fix Proposal
     ↓
Authorization
     ↓
Implementation
     ↓
Validation
Boundary

The fix engine should remain separate from:

Raw crawling
Analysis
Authentication
AI provider management

It may consume results from these systems but should not own their responsibilities.

## 19. Validation Engine
Responsibility

The validation engine determines whether a recommendation or fix produced the expected result.

Validation Flow
Issue
  ↓
Recommendation
  ↓
Fix
  ↓
Implementation
  ↓
Re-crawl / Re-analysis
  ↓
Validation
  ↓
Pass / Fail / Partial
Validation Principle

Validation should be evidence-based.

A fix should not be considered successful simply because:

A recommendation was generated
A change was submitted
A change was marked complete

The system should re-check the relevant evidence.

Validation Results

A validation result may contain:

Validation run
Related fix
Expected result
Actual result
Evidence
Status
Timestamp
Boundary

The validation engine should verify changes but should not be responsible for generating the original recommendation.

## 20. Monitoring
Responsibility

Monitoring tracks both system health and intelligence changes over time.

System Monitoring

Potential monitoring areas include:

API health
Job failures
Worker health
Crawl health
AI provider errors
Database errors
Connector failures
Usage
Quotas
Intelligence Monitoring

Potential monitoring areas include:

SEO changes
AI visibility changes
Citation changes
Competitor changes
Opportunity changes
Validation results
Purpose

Monitoring should support:

Alerts
Historical analysis
Failure investigation
Trend detection
Operational visibility
Example Flow
System / Intelligence Event
        ↓
Monitoring
        ↓
Metric
        ↓
Threshold / Change Detection
        ↓
Alert

## 21. Connectors
Responsibility

The connectors module provides controlled integrations with external systems.

Potential Integrations

Potential integrations include:

GitHub
CMS platforms
Google Search Console
Analytics platforms
Other approved external services
Connector Responsibilities

Connectors should:

Authenticate securely
Retrieve approved external data
Send approved changes where authorized
Normalize external data
Handle external API failures
Respect provider limits
Record synchronization status
Security Boundary

Connectors should use secure authentication.

Credentials and tokens should not be exposed to individual intelligence modules.

Integration Flow
External System
      ↓
Connector
      ↓
Authentication
      ↓
Data Retrieval / Action
      ↓
Normalization
      ↓
Raval Intelligence

## 22. Database
Technology

PostgreSQL

Responsibility

The database stores structured system, website, analysis, intelligence, recommendation, validation, and monitoring data.

Core Logical Entities

Potential entities include:

Workspace
Website
Crawl
Page
Observation
SEO Finding
Content Finding
Entity
AI Benchmark
AI Run
Answer
Mention
Citation
Competitor
Opportunity
Recommendation
Fix
Validation Run
Monitoring Event
Evidence Lineage

Relationships between these entities should preserve evidence lineage.

Example:

Workspace
   ↓
Website
   ↓
Crawl
   ↓
Page
   ↓
Observation
   ↓
Finding
   ↓
Opportunity
   ↓
Recommendation
   ↓
Fix
   ↓
Validation
Data Principle

The database should support:

Structured storage
Relationships
Evidence lineage
Historical records
Workspace isolation
Validation history
Monitoring history
Boundary

Application modules should access data through controlled data-access patterns rather than creating uncontrolled direct access from unrelated components.

## 23. AI Gateway
Responsibility

The AI Gateway provides centralized access to AI providers.

Architecture
SEO Engine ──────┐
Content Engine ──┤
Entity Engine ───┤
GEO Engine ──────┤
Recommendation ──┘
                  │
                  ▼
             AI Gateway
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
    Provider A Provider B Provider C
Responsibilities

The AI Gateway should handle:

Provider selection
Model selection
Authentication
Usage tracking
Rate limiting
Cost tracking
Structured outputs
Error handling
Provider abstraction
Centralization Principle

Individual engines should not create disconnected AI provider integrations.

AI access should pass through the centralized gateway where practical.

Benefits

Centralized AI access allows the system to:

Change providers
Change models
Track usage
Apply limits
Control costs
Standardize outputs
Centralize AI security controls
Boundary

The AI Gateway should provide AI access but should not own the business logic of individual engines.

## 24. Data Flow
Primary Data Flow

The primary end-to-end flow is:

1. User creates or selects a website
        ↓
2. Backend creates a crawl job
        ↓
3. Job enters the queue
        ↓
4. Worker executes the crawler
        ↓
5. Crawler collects website evidence
        ↓
6. Evidence is stored
        ↓
7. SEO / Content / Entity engines process evidence
        ↓
8. AI intelligence processes benchmark questions where required
        ↓
9. Citation and competitor intelligence is generated
        ↓
10. Results are unified
        ↓
11. Opportunities are generated
        ↓
12. Recommendations and fixes are proposed
        ↓
13. Validation is performed
        ↓
14. Monitoring tracks changes over time
Simplified End-to-End Architecture
Website
   ↓
Crawler
   ↓
Website Evidence
   ↓
SEO / Content / Entity
   ↓
GEO / AEO / AI
   ↓
Citations / Competitors / Analytics
   ↓
Unified Intelligence
   ↓
Opportunities
   ↓
Recommendations
   ↓
Fixes
   ↓
Validation
   ↓
Monitoring
Data Flow Principle

Each stage should consume structured outputs from the previous stage and produce structured data for downstream stages.

## 25. Security Boundaries

Security must be applied at multiple system boundaries.

User → API

Controls include:

Authentication
Authorization
Workspace isolation
Rate limits
API → Workers

Controls include:

Validated job payloads
Permission checks
Quotas
Job authorization
Workers → Crawler

Controls include:

URL validation
SSRF protection
Crawl limits
Resource limits
Safe request handling
Services → Database

Controls include:

Controlled database access
Tenant isolation
Appropriate permissions
Secure credentials
Services → AI Gateway

Controls include:

Centralized credentials
Rate limits
Usage controls
Structured outputs
Provider isolation
AI → Tools / Actions

AI output should be validated before any action is executed.

AI Output
   ↓
Schema Validation
   ↓
Policy Validation
   ↓
Authorization
   ↓
Tool Execution
Security Principle

Security should be treated as a system-wide responsibility rather than as a single component.

## 26. Failure Handling

The architecture should expect failures.

Potential Failures

Examples include:

Website unavailable
Crawl timeout
Invalid URL
AI provider failure
API timeout
Queue failure
Database failure
Connector failure
Worker failure
External service failure
Long-Running Job Handling

Long-running jobs should support:

Retry
Failure status
Error recording
Observability
Safe recovery
Failure Isolation

A single failed page or AI request should not unnecessarily fail the entire workspace operation.

Where practical, failures should be isolated to:

Affected page
Affected job
Affected provider request
Affected connector operation
Error Information

Failures should preserve enough information for:

Debugging
Monitoring
Retry decisions
User-visible status
Operational investigation
## 27. Scalability Direction

The initial architecture should support future scaling.

Potential Scaling Architecture
Frontend
   ↓
API Instances
   ↓
Job Queue
   ↓
Multiple Workers
   ↓
Crawler Workers
   ↓
Analysis Workers
   ↓
AI Gateway
   ↓
PostgreSQL
Scaling Principle

Individual workloads should be independently scalable where practical.

For example:

API instances can scale independently
Crawl workers can scale independently
Analysis workers can scale independently
AI workloads can scale independently
Why This Matters

Crawling, analysis, and AI workloads may have different resource requirements.

Separating them allows the system to scale the expensive or high-volume workloads without unnecessarily scaling every component.

## 28. Architectural Principles

The system should follow these principles:

Modular responsibilities
Clear service boundaries
Evidence-first intelligence
Centralized AI access
Asynchronous long-running operations
Secure external integrations
Workspace isolation
Testable business logic
Observable background jobs
Safe and validated automation
Reusable intelligence across dashboards and recommendations
Avoid unnecessary coupling between modules
Evidence-First Principle

Recommendations should be traceable to supporting evidence.

The system should be able to identify why a finding, opportunity, or recommendation was generated.

Modular Principle

Each engine should have a clear responsibility and should avoid duplicating another engine's work.

Security Principle

External systems, credentials, AI providers, and crawler operations should be protected by explicit security boundaries.

Automation Principle

Automated changes should be validated and authorized before execution.

Reusability Principle

Evidence and intelligence should be reusable across dashboards, reports, recommendations, validation, and monitoring.

## 29. Current Architecture Status

The architecture defines responsibilities and boundaries but does not represent full production implementation.

Technology choices, infrastructure sizing, queue selection, authentication provider, and deployment configuration may be refined after implementation requirements and operational constraints are validated.


