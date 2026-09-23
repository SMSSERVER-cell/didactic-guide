# Missed Call Text Back Service — server

Multi-tenant Twilio 10DLC server for local shops. One codebase. A new client is a new record, not a forked repo.

Public brand on the marketing site: **Missed Call Text Back Service**.  
Name on every outbound text: the shop **DBA**, never this company name and never any internal project name.

This repo is the product. Claude Code (or any assistant) may refine it. It may not invent a second send path, mix the demo number with a client number, or go live from a draft.

---

## What it does

1. Caller dials the shop’s Twilio number.
2. Voice webhook plays a one-time consent prompt, then dials `forwardTo`.
3. If the shop does not answer (`no-answer` / `busy` / `failed`), the server sends **one** campaign SMS through that shop’s Messaging Service SID.
4. Keep / Prove shops can also send appointment reminders (and Prove a review text) from filed scripts only.
5. Chapter 3 intake becomes a **draft** client. Drafts never send. Go-live requires E.164 + `MG…` SID + Gate C on T-Mobile and Verizon.

Plans:

| Plan | What the server is allowed to send |
|---|---|
| `catch` | Missed-call text only |
| `keep` | Missed-call + appointment reminder |
| `prove` | Missed-call + reminder + one review request |

---

## Hard rules (do not “improve” these)

Assistants working in this repo: treat this list as law.

- **Drafts never send.** Webhooks must resolve with `findLiveClient`. A row with `status: "draft"` or `"blocked"` is invisible to Twilio traffic.
- **Campaign SMS requires an `MG…` Messaging Service SID.** Never send 10DLC with a bare `From`. A `CM…` message SID is not a Messaging Service SID.
- **Live SMS body must match the filed TCR sample.** Changing punctuation, adding a coupon, or swapping HELP/STOP language risks Error 30007.
- **Scripts start with the DBA and end with STOP / HELP.** No `bit.ly`, no short links, no “discount”, “% off”, “act now”, “last chance”, “free consult”.
- **Owner `[ALERT]` texts do not go out on a shop or demo campaign number.** Use `TWILIO_ALERT_FROM_NUMBER` (a non-campaign sender) or log only.
- **Demo number and client number are not interchangeable.** Do not copy the demo MG SID onto a shop. Do not point a shop webhook at the demo config.
- **One location per intake form.** Blank required field = do not write the draft, do not file A2P.
- **Do not treat `clients.json` on Render as durable** unless a persistent disk is attached. Ephemeral disk resets on deploy.
- **Do not collect a go-live date while the demo line is still carrier-filtered.** Setup fee can be taken on a signed complete intake. Monthly billing starts at Gate C.

Default missed-call script (custom copy must keep the same skeleton):

```
[DBA]: Sorry we missed your call. We'll call you back shortly. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

Locked demo body (do not rewrite):

```
Colby Gay: Sorry we missed your call. We will follow up. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

---

## Repo map

| File | Role |
|---|---|
| `server.js` | Express app. Voice + consent + dial-complete webhooks, appointment form, reminder loop, `/health`. |
| `clientRoutes.js` | Internal draft / intake / go-live / block API + `findLiveClient` + script validation. |
| `parseIntake.js` | Chapter 3 PDF / OCR text → field object. |
| `intakeToClient.js` | CLI: scan PDF → preview or `--commit` a draft. |
| `clients.json` | **Target store for the intake pipeline:** `{ "version", "clients": [ … ] }`. |
| `clients.demo.json` | **Shape the running `server.js` still loads today:** `{ "+1…": { … } }`. Demo-only. Do not merge into a live shop row. |
| `clients.example.json` | Committed, fake-number example of the array store (one `live`, one `draft`). Shape reference only. |
| `sheets.js` | Appends one row per missed call to the client’s own Google Sheet. Never sends SMS. |
| `appointments.js` | Keep/Prove reminder store + scheduling (required by `server.js`). |
| `.env.example` | Every env var, with comments. Copy to `.env`. |
| `test/` | `node --test` suites. |
| `SCHEME.pdf` | Chapter 3 playbook / print intake. |
| `website-builder-brief.md` | Public site spec. Not this server. |

`server.js` also `require`s `./sheets` and `./appointments`. Those modules belong in this repo when you clone it for Claude. If they are missing locally, do not stub them by sending SMS from a new path.

**This repo is public.** `clients.json`, `clients.demo.json`, `appointments.json` and `.env` are in `.gitignore` because they hold real shop numbers, SIDs, and customer phone numbers. Keep them that way.

---

## Known gap (fix this first)

Two store shapes exist. They are not compatible yet.

| | Intake / `clientRoutes.js` | Live `server.js` (today) |
|---|---|---|
| File | `clients.json` | `clients.json` loaded as a phone-keyed object |
| Shape | `{ version, clients: [ { id, status, twilio_number, … } ] }` | `{ "+1857…": { clientName, forwardTo, message, messagingServiceSid, sheetId } }` |
| Lookup | `findLiveClient(store, req.body.To)` | `clients[calledNumber]` |
| Draft safety | Drafts have `status: "draft"` and no send | **No status field. Every key can send.** |

Until `server.js` loads the array store and looks up with `findLiveClient`, a draft written by `intakeToClient.js` **will not fire webhooks** — and a naive merge of the demo file into the array store **will not be read** by the current server.

Preferred end state:

```js
const { createClientRouter, findLiveClient } = require("./clientRoutes");

app.use("/internal", createClientRouter({
  clientsPath: path.join(__dirname, "clients.json"),
  internalKey: process.env.INTERNAL_KEY,
}));

// In every voice / SMS webhook:
const clientConfig = findLiveClient(await loadClients(), req.body.To);
```

Do not keep both shapes in production. Pick the array store, mount `/internal`, and make webhooks ignore anything that is not `status: "live"`.

---

## Client record

Minimum fields for a **draft**:

- `plan` — `catch` | `keep` | `prove`
- `clientName` — DBA / name on the text
- `legalName`
- `forwardTo` — E.164
- `ownerMobile` — E.164
- `areaCode` — 3 digits
- `message` — or the default missed-call script

Required to flip **live**:

- `twilio_number` — E.164 on the Messaging Service
- `messagingServiceSid` — `MG` + 32 hex
- Gate C approved on T-Mobile and Verizon for that number
- Live body identical to the TCR sample for that campaign

Prove also needs a full `https://` Google review URL. No short links.

Statuses: `draft` → `live` → `blocked`. Blocked shops cannot go live again without a human putting them back.

---

## Internal API

Mount at `/internal`. Header: `x-internal-key: $INTERNAL_KEY`.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/internal/clients` | List store (no redaction — internal only) |
| `GET` | `/internal/clients/:id` | One row |
| `POST` | `/internal/clients` | Create `status=draft` from mapped fields |
| `POST` | `/internal/intakes` | OCR text or fields from a scanned Chapter 3 form |
| `POST` | `/internal/clients/:id/go-live` | Set number + MG SID, set `status=live` |
| `POST` | `/internal/clients/:id/block` | Pull a shop off the send path |

`POST /internal/intakes?preview=1` or `{ "commit": false }` validates and returns blockers. Writes nothing.

Blank required field → `422` with `blockers[]`. Duplicate live/draft shop → `409`.

---

## Intake CLI

```bash
# Preview only — prints fields + blockers, writes nothing
node intakeToClient.js /path/to/intake.pdf

# Write a draft if validation passes
node intakeToClient.js /path/to/intake.pdf --commit
```

Handwritten scans need `OPENAI_API_KEY`. Typed PDFs often parse without it. One location per form.

---

## Webhooks (Twilio)

Point the number’s voice webhook at this host (Render, after the demo line is actually delivering).

| Path | When |
|---|---|
| `POST /voice` | Inbound call. Consent prompt, then dial `forwardTo`. |
| `POST /voice/consent` | Caller pressed 1 / said yes. Dial shop. |
| `POST /voice/complete` | Dial finished. On miss → one campaign SMS + sheet log. |
| `GET /health` | Liveness. Do not put secrets here. |
| `GET/POST /appointments/new` | Keep/Prove booking form (needs the live lookup fix). |

Signature validation is on when `NODE_ENV=production`.

STOP / HELP are handled by the Messaging Service / Advanced Opt-Out, not by inventing a second inbound SMS handler unless TCR requires it.

---

## Environment

Required to boot `server.js`:

```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
```

Required before any real traffic:

```
NODE_ENV=production
OWNER_ALERT_NUMBER          # E.164 — ops phone, not a shop cell if you can avoid it
TWILIO_ALERT_FROM_NUMBER    # non-campaign sender for [ALERT] texts
INTERNAL_KEY                # /internal routes
```

Optional / local:

```
OPENAI_API_KEY              # handwritten intake OCR
PORT                        # default 3000
GOOGLE_SERVICE_ACCOUNT_EMAIL  # Sheets call log, shared by all clients
GOOGLE_PRIVATE_KEY            # quoted, with literal \n line breaks
```

A blank `TWILIO_ALERT_FROM_NUMBER` means **log the alert only**. It never falls back to a shop or demo number.

Never commit `.env`, live SIDs, or real shop numbers. `clients.demo.json` is a local demo snapshot — treat it as sensitive and keep it out of a public remote.

---

## Google Sheets call log

Optional, per client. Blank `sheetId` = no logging for that shop.

1. Create the sheet. Put this header in row 1 of the first tab: `Timestamp (UTC) | From | To | Dial status | SMS sent`.
2. Share the sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor**.
3. Put the sheet ID (the long string in the sheet URL) in the client’s `sheetId`. Optional `sheetTab` if the tab is not `Sheet1`.

Values are written `RAW`, so `+1…` numbers stay text and a caller ID can never become a formula. A logging failure rejects so `server.js` can raise an `[ALERT]`. It must never block or retry the SMS.

---

## Local run

```bash
cp .env.example .env                # then fill it in
cp clients.demo.json clients.json   # only for the current server.js shape
# or keep the array store once server.js uses findLiveClient
npm install
node server.js
```

`GET http://localhost:3000/health` should return `{ status: "ok", … }`.

Tests:

```bash
node --test
```

**Windows vs Render:** Windows ignores filename case, Render (Linux) does not. `Appointments.json` and `appointments.json` are the same file on OneDrive and two different files on Render. Use lowercase data filenames and make the code use the exact same spelling.

---

## Hosting and go-live order

1. One demo SMS delivers on the demo 10DLC. Open Twilio ticket stays open until that is true.
2. Colby stays on the Windows / OneDrive copy until that demo lands. Render is after that, not in parallel.
3. Attach a persistent disk on Render if `clients.json` is the source of truth. Otherwise writes vanish on deploy.
4. New shop: signed complete intake → Stripe setup fee → Colby files A2P on that brand/campaign → Gate C on the **client** number → `POST /internal/clients/:id/go-live` → monthly billing starts.
5. Extra location / extra number is a new record, not a second server.

Public site (privacy + messaging terms) must list missed-call + Keep reminders + Prove review texts **before** those campaigns are filed. See `website-builder-brief.md`. Replace contact email, date, and legal name before TCR points at the URL.

---

## What Claude Code should work on

Safe and useful:

- Wire `server.js` to the array store + `findLiveClient` + `/internal`.
- Make `/health` report live-count vs draft-count without leaking numbers.
- Harden reminder / review sends so Keep/Prove still refuse a blank or unfiled body.
- Tests around `validateClient`, `scriptProblems`, `findLiveClient`, and “draft does not send”.
- Structured logging that never prints full SMS bodies in production.

Out of scope unless a human asks:

- Rewriting the locked demo SMS body.
- Adding coupons, shorteners, or “we get you more customers” copy.
- Forking the repo per shop.
- Pointing TCR or the public site at an internal project name.
- Inventing LLC name, EIN, or legal address.

---

## Owners

Colby Gay — product, Twilio, A2P, Render, Gate C.  
Adam St Pierre — LLC, sales, intake, client success.

Maine. Target 50/50 LLC. Working name stays off the public site and off every customer text.
