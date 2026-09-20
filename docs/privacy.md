# Data, privacy, and compliance considerations

The application processes workspace content, brand information, conversation
history, generated assets, connector metadata, analytics data, usage events,
webhook events, and provider responses. OAuth and provider credentials are
server-side and encrypted where the implementation requires it.

Workspace membership and RLS are the primary tenant controls. Audit logs and
usage records support operational accountability. External providers may
process prompts, URLs, content, or analytics data; provider-specific data
processing terms are outside this repository.

## Documentation boundary

This repository does not prove a privacy notice, DPA, retention schedule,
regional hosting commitment, deletion/export workflow, or regulatory
certification. Those are **TODO**, requiring product/legal approval. Do not
infer GDPR, SOC 2, HIPAA, or other compliance claims from the presence of RLS,
encryption, or audit tables.

## Engineering requirements

Avoid logging secrets, tokens, full raw provider responses, or unnecessary
personal data. Scope reads/writes to the verified workspace, redact error
messages, encrypt stored credentials using the established crypto modules, and
make webhook/event processing idempotent. Changes affecting data fields,
retention, exports, or third-party transfers require a privacy review.
