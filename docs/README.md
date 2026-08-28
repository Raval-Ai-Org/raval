# RavalAI Documentation

> Index of architectural and operational docs for the RavalAI platform.

This folder lives next to the code so the team can find context without digging
through external planning tools.

## 📂 Folder structure

```
docs/
├── README.md                            (this file)
├── TEAM-CREDENTIALS.md                  How to share .env safely between team members
├── PLATFORM-CREDENTIALS-STATUS.md      Which dev apps are wired (LinkedIn/Meta/X) and their review status
├── adr/                                 Architecture Decision Records
│   ├── 0001-proxy-through-server-for-sdr-access.md
│   ├── 0002-split-scheduling-generation-vs-distribution.md
│   ├── 0003-deployment-topology-local-first-oracle-tunnel.md
│   ├── 0004-sdr-integration-full-record.md
│   └── 0005-aws-lightsail-sdr-production-deployment.md
└── specs/                               Feature specifications
    └── 001-sdr-integration/
        ├── spec.md                      Feature requirements
        ├── plan.md                      Architecture plan
        ├── tasks.md                     Task breakdown
        ├── quickstart.md                Local SDR setup walkthrough
        ├── data-model.md                Database schema
        ├── research.md                  Pre-build research
        ├── INTEGRATION-HOLD.md          Current state of integration
        ├── CLIENT-LAUNCH-PLAN.md        Phase-by-phase launch plan
        ├── contracts/                   API contracts
        │   ├── sdr-proxy.md
        │   └── sdr-webhook.md
        └── checklists/
            └── requirements.md          Requirements checklist
```

## 🧭 Where to look

| If you want to... | Read this |
|---|---|
| Set up your local dev environment | [README.md](../README.md) → Quick start |
| Get `.env` values from a teammate | [TEAM-CREDENTIALS.md](TEAM-CREDENTIALS.md) |
| Understand a past architectural decision | [adr/](adr/) — start with `0001` and read forward |
| Understand the SDR integration design | [specs/001-sdr-integration/spec.md](specs/001-sdr-integration/spec.md) |
| See the launch plan (timeline + phases) | [specs/001-sdr-integration/CLIENT-LAUNCH-PLAN.md](specs/001-sdr-integration/CLIENT-LAUNCH-PLAN.md) |
| See what's currently blocked / in progress | [specs/001-sdr-integration/INTEGRATION-HOLD.md](specs/001-sdr-integration/INTEGRATION-HOLD.md) |
| Deploy SDR to AWS Lightsail | [adr/0005-aws-lightsail-sdr-production-deployment.md](adr/0005-aws-lightsail-sdr-production-deployment.md) |

## 🆕 Adding new docs

- **ADRs** (`docs/adr/NNNN-title.md`): Use `.specify/templates/adr-template.md` as a starting point. Number sequentially.
- **Feature specs** (`docs/specs/NNN-feature-name/`): Use the spec.md / plan.md / tasks.md / quickstart.md templates from `.specify/templates/`.
- **Operational docs** (this folder): Just drop a `.md` file with a clear name and link it from this index.

All docs are committed with the code, so the team always sees the latest version when they pull.

## 📝 Note on planning vs. product docs

The historical planning workspace (PHRs, raw research, half-written plans) lives
in the team's private `project-alpa/` folder, NOT in this repo. Only finalized,
team-useful docs are promoted into `docs/`. The bar is: **"would a new team
member need this on day 1?"** If yes, it's here. If no, it stays in planning.
