# Missed-call text-back

Three webhooks. Someone rings the business number, it forwards to the owner's
cell for twenty seconds, and if they do not pick up the caller gets one text.

| route | Twilio setting | what it does |
|-------|----------------|--------------|
| `/api/twilio/voice` | A Call Comes In | dials `OWNER_CELL`, caller's number as caller ID |
| `/api/twilio/dial-status` | set by `voice`, not configured by hand | texts the caller if the dial did not complete |
| `/api/twilio/sms` | A Message Comes In | forwards inbound texts to `OWNER_CELL` |

## Environment

Set in Vercel, for Production and Preview:

| variable | what it is |
|----------|------------|
| `TWILIO_ACCOUNT_SID` | account SID, starts `AC` |
| `TWILIO_AUTH_TOKEN` | auth token — also what every signature is checked against |
| `OWNER_CELL` | the cell to ring and forward to, E.164, e.g. `+1XXXXXXXXXX` |
| `TEXTING_LIVE` | `true` to send the missed-call text. Anything else, or unset: no text, and the caller hears "I'll call you back" instead. Leave it off until the texting campaign is approved |
| `AUTO_TEXT` | optional: replaces the wording of the missed-call text |
| `PUBLIC_BASE_URL` | optional: only if a proxy rewrites the host and signatures start failing |

Until the first two are set every route answers **503**, which is deliberate:
a missing configuration should be visible, not a crash Twilio retries into.

## What is deliberate

- **Nothing is trusted before the signature is checked.** These URLs are
  public, so every route validates `X-Twilio-Signature` against the auth token
  and the full request URL, and returns 403 otherwise.
- **No route takes a destination from a request parameter.** The only numbers
  written to are the caller of the call in hand and `OWNER_CELL`, and both are
  checked to be E.164 before anything is sent.
- **STOP, START and HELP are Twilio's job.** Nothing here replies to the
  sender, so we can never text somebody who has just asked us to stop.
- **A failed send does not promise a text.** If Twilio refuses the message the
  call hangs up quietly rather than saying one is on its way.
- **No password.** These are not behind Signal's `LOOKUP_PASSWORD`; Twilio
  cannot send one, and the signature is the authentication.

Run the tests with `npm test` from the repository root. They never call Twilio.
