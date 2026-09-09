# WhatsApp campaign backend

Local API prefix: `/api/campaign-workspace/whatsapp`. Every request requires the signed-in user's platform bearer token. No UI changes are included.

## Template lifecycle

POST `templates/create`, `templates/sync`, `templates/delete`, and `templates/upload-image` forward to the authenticated platform template APIs. Creation accepts `{name,language,category,components}` using Meta template components. GET `templates` returns the cached list. Meta approval is required before sending.

## Start

POST `campaigns/:id/start`:

```json
{
  "template_id": "owned-template-id",
  "selected_contact_ids": ["owned-audience-contact-id"],
  "parameter_bindings": {"1": "name", "order_number": "order", "header_media_url": "image_url"},
  "delay_seconds": 0.1
}
```

The template ID defaults to the saved campaign template. Omitting selection sends the entire saved audience. Prefer IDs; optional `selected_contact_indexes` follows the authenticated contacts listing filtered to audience members. GET `contacts` and `audiences/:id/contacts` expose those lists.

Start checks ownership, retrieves the current approved Meta template, resolves metadata and named/positional fields, validates every selected contact, and snapshots recipients and template in the local SQLite database before sending. Access tokens are not saved in that database. Saved platform credentials are fetched per start.

Text body/header parameters, image/video/document header URLs, and dynamic URL button parameters are supported. Static quick-reply/phone buttons require no parameters. Unsupported component types, including carousel/flow/location, fail validation before sending.

GET `campaigns` merges local run status with owned platform campaigns. GET `campaigns/:id` also reconciles delivery/read receipts from platform chat messages. The existing public platform webhook must be configured with Meta; localhost is not a webhook endpoint. Receipt polling never invents delivered/read status.

Runs persist in `DATA_DIR/whatsapp-campaigns.db`. Sending is sequential with the configured minimum delay. Do-not-contact selections are rejected. Configured daily caps currently block the local runner because it cannot atomically reserve the platform's shared quota.

Confirmed provider rejections are failed; timeouts or missing provider IDs are unknown. Server restart marks active runs interrupted. Existing runs cannot be started again automatically; this prevents duplicate delivery. Create a new campaign only after reviewing previous outcomes. This local process must remain running to complete a run.

Messages are mirrored to platform chats after Meta accepts them. A chat-record failure preserves the sent result and adds `record_error`. Receipt reconciliation requires that chat record. No automatic resend occurs.

Template management and live Meta delivery require the existing platform endpoints to be deployed and reachable. Tests mock external services; no real messages are sent by the test suite.
