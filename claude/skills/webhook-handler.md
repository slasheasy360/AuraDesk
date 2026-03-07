# Skill: Webhook Handler

Webhook endpoints must follow these rules:

1. Validate signature (Meta X-Hub-Signature-256)
2. Save payload immediately
3. Return HTTP 200 within 5 seconds
4. Process message asynchronously

Webhook payload must be stored in:

webhook_events_log

Fields:

id
platform
received_at
payload
processed
error

All webhook handlers must be idempotent.

Duplicate events must not create duplicate messages.