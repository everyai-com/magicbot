# WhatsApp Contacts, Audiences, Integrations and API: current implementation

Inspected September 11, 2026. This describes the checked-out code, not a claim that a production deployment matches it. Source.zip contains the full relevant source files, including the separate platform reference routes. No runtime configuration or credential files are included. The source bundle is a reference, not a standalone runnable project.

## Architecture and the important split

The four menu entries are in src/components/LocalComputerSection.tsx. UI requests use the existing authenticated api() helper. Vite proxies /api to the Node backend on port 8799.

Contacts and Audiences in this menu call /api/whatsapp/contacts and /api/whatsapp/audiences. Their Node handlers use server/whatsapp-db.ts and DATA_DIR/messages.db. These tables are local and have no user_id column. They are not the hosted campaign contact store.

CampaignWorkspace uses /api/campaign-workspace/whatsapp/... instead. server/campaign-workspace.ts allowlists those requests, which are forwarded with the user's authorization to the platform. The platform uses user-scoped contacts and audiences. Saving a contact or audience in the four-section menu does not automatically sync it into the campaign database.

API and Integration settings take a third route: server/whatsapp-settings.ts intercepts /api/whatsapp/configs* and proxies authenticated configuration reads/writes to the platform. Both Node and the hosted web Worker use this adapter. Legacy local configuration handlers remain below the interceptor; they are not the active implementation for the intercepted requests.

## 1. WhatsApp Contacts

Purpose: import and maintain name/phone records. This does not send messages.

Flow: Contacts panel -> api('/api/whatsapp/contacts') -> Node handlers -> messages.db -> response -> UI list.

Routes:
- GET /api/whatsapp/contacts returns {contacts:[...]}.
- POST /api/whatsapp/contacts accepts {name,phone} and returns {contact:...}.
- POST /api/whatsapp/contacts/bulk accepts {contacts:[{name,phone}]} and returns {contacts:[...]}.
- PUT or PATCH /api/whatsapp/contacts/:id updates the record.
- DELETE /api/whatsapp/contacts/:id deletes it.

The bulk handler accepts at most 1000 entries, drops entries without a phone, and deduplicates on the phone string. phone_number is accepted as an alias by the parser. This is not full international phone normalization: '+1 555...' and '+1555...' can differ. Existing exact phone matches update the name. Local columns: id, name, phone UNIQUE, created_at, updated_at. Database file permissions are set to 0600; SQLite foreign keys and WAL are enabled.

Configuration: local backend running with writable DATA_DIR. Meta credentials are not required just to maintain records. This is a device-level store, not per-user hosted storage.

## 2. WhatsApp Audiences

Purpose: group contacts under a name and optional description. Audiences are membership lists, not WhatsApp group chats.

Flow: panel loads contacts and audiences -> select members/create audience -> POST -> SQLite audience and membership records -> UI reloads lists.

Routes:
- GET /api/whatsapp/audiences returns {audiences:[...]}.
- POST /api/whatsapp/audiences accepts {name,description,contactIds:[...],contacts:[{name,phone}]}.
- PUT /api/whatsapp/audiences/:id updates it.
- DELETE /api/whatsapp/audiences/:id deletes it.

Create limits: name required and at most 100 characters; description at most 1000; contact arrays at most 1000. The membership table links whatsapp_audiences and whatsapp_contacts through foreign keys with cascade deletion.

Example request body:
```json
{"name":"Customers","description":"Order updates","contactIds":["existing-contact-id"]}
```

Campaigns instead use hosted POST /api/whatsapp/audiences with hosted contact IDs. Local IDs should not be passed to that endpoint. To make these four menu sections feed campaigns, the contact/audience UI and backend must use the same hosted store and response mapping as CampaignWorkspace. That unification is not implemented here.

## 3. WhatsApp Integrations

Purpose shown by the UI: enable auto-reply and configure a forwarding webhook.

Flow actually implemented: GET /api/whatsapp/configs -> adapter reads hosted auto-reply configuration -> UI edits toggle/URL -> POST /api/whatsapp/configs/auto-reply -> adapter forwards {is_enabled,webhook_url} -> platform upserts whatsapp_auto_reply_configs for the authenticated user.

Example:
```json
{"is_enabled":true,"webhook_url":"https://your-service.example/whatsapp/inbound"}
```

The UI describes a response contract:
```json
{"reply_message":"Thanks for your message. How can we help?"}
```
It says JSON without reply_message skips replying and that replies are routed to the sender.

Important gap: the inspected platform inbound webhook handler records inbound messages and delivery receipts but does not read whatsapp_auto_reply_configs, call the forwarding URL, or send reply_message back to Meta. Therefore saving these settings is functional, but the described automatic forwarding/reply flow is not established by the inspected backend. A separate deployed handler may differ; that was not verified.

A complete implementation would need to load the owner's enabled setting, forward the inbound event to the configured HTTPS service, validate its response, and send a text reply through the owner's phone-number ID. It also needs delivery deduplication, request timeout handling and safe webhook destinations. This guide does not claim those missing steps exist.

## 4. WhatsApp API

Purpose: save the user's Meta Cloud API credentials and display webhook verification details.

UI fields and platform names:
- Meta Access Token -> meta_access_token
- Meta Phone Number ID -> meta_phone_number_id (an ID, not the visible telephone number)
- Meta Business Account ID -> meta_business_account_id (WABA ID)
- Meta App ID -> meta_app_id
- display_phone_number and verified_name -> informational values returned by validation
- Webhook URL and Verify Token -> read-only values from whatsapp_webhook_configs

Routes:
- GET /api/whatsapp/configs/api loads the settings through the adapter.
- POST /api/whatsapp/configs/validate forwards {accessToken,phoneNumberId,businessAccountId}; valid:true is required for adapter success.
- POST /api/whatsapp/configs/api forwards the meta_* fields to hosted storage.
- GET /api/whatsapp/configs/webhook reads the callback details.

Example save body (placeholders only):
```json
{"meta_access_token":"YOUR_TOKEN","meta_phone_number_id":"YOUR_PHONE_NUMBER_ID","meta_business_account_id":"YOUR_WABA_ID","meta_app_id":"YOUR_APP_ID"}
```

A blank token retains the previously saved token. 'Configured' only tests that token, phone ID and WABA ID exist; it does not prove the token remains valid. The adapter returns the saved access token to the authenticated browser; it is not merely a masked boolean. No automatic token refresh is implemented by this adapter.

Configuration sequence:
1. Sign into the MagicTeams account whose WhatsApp settings should be used.
2. Enter the appropriate Meta token, phone-number ID, WABA ID and app ID.
3. Click Validate Credentials, then Save WhatsApp API.
4. If the platform returns a webhook URL and verify token, copy those into the Meta webhook configuration. Use a publicly reachable HTTPS callback, not localhost.
5. Enable the relevant message event subscription and verify with an inbound test message and a delivery receipt.

The platform handler GET /api/webhooks/whatsapp/:key looks up whatsapp_webhook_configs, checks hub.mode=subscribe and hub.verify_token, and returns hub.challenge. POST to the same route stores an event, creates/updates inbound contacts and conversations/messages, and updates sent/delivered/read/failed statuses by provider_message_id.

The inspected API configuration save route only upserts credential fields. It does not create webhook configuration rows itself. If callback fields are blank, the UI cannot generate them from this save handler alone; the platform needs an existing provisioning flow/row.

## How these connect to sending

Hosted contacts -> hosted audience -> approved template -> campaign -> user's saved API configuration -> Meta send -> saved outcome/provider message ID -> webhook delivery status -> Completed/History.

The local WhatsApp runner is server/whatsapp-campaigns.ts. It resolves campaign/template/audience membership through authenticated platform calls, validates the approved template and recipients, reads the saved Meta configuration, sends sequentially and persists runs in DATA_DIR/whatsapp-campaigns.db. It mirrors sent messages to the platform. Receipt reconciliation reads those platform messages.

Contacts alone do not send; audiences alone do not send; saving API settings does not start campaigns; enabling Integrations currently saves settings but does not prove replies are being executed.

## Running this checkout

Use the repository's existing dependency lockfile and configured authenticated platform connection. package.json requires Node >=24.
```sh
pnpm install --frozen-lockfile
pnpm dev:server
# In a second terminal:
pnpm dev --host 127.0.0.1 --port 5199 --strictPort
```
Do not paste real Meta tokens into source files or this guide. Existing platform configuration/authentication is required for hosted reads and writes. These instructions do not deploy or migrate the separate platform.

## Code index (paths inside source.zip)

magic-bot/src/components/LocalComputerSection.tsx: menu, all four panels, imports and form requests.
magic-bot/server/index.ts: local contact/audience routes and configuration adapter entry point.
magic-bot/server/whatsapp-db.ts: local schema and CRUD.
magic-bot/server/whatsapp-settings.ts: authenticated hosted settings translation.
magic-bot/cloudflare/web/src/index.ts: hosted entry point; do not assume the Node-only SQLite contact routes exist there.
magic-bot/server/campaign-workspace.ts: campaign proxy allowlist.
magic-bot/server/whatsapp-campaigns.ts: local send runner and results.
magic-bot/src/components/CampaignWorkspace.tsx: hosted contact/audience campaign flow.
platform-reference/worker-api/src/routes/whatsapp.ts: user-scoped platform CRUD, configurations and templates.
platform-reference/worker-api/src/routes/webhooks.ts: inbound Meta verification, storage and receipt updates.

## Verification limits

This is a source inspection. No contacts were uploaded, messages sent, credentials validated, or external webhooks invoked while producing it. Source proves the routes and gaps described above; it does not prove the currently deployed platform has identical code.
