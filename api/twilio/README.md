# Missed-call text-back

Three webhooks. Someone rings the business number, it forwards to the owner's
cell for twenty seconds, and if they do not pick up the caller gets one text.

| route | Twilio setting | what it does |
|-------|----------------|--------------|
| `/api/twilio/voice` | A Call Comes In | dials `OWNER_CELL`, caller's number as caller ID |
| `/api/twilio/dial-status` | set by `voice`, not configured by hand | texts the caller if the dial did not complete |
| `/api/twilio/sms` | A Message Comes In | forwards inbound texts to `OWNER_CELL`; texts from `OWNER_CELL` are replies, sent on from the business number |

## Texting customers from the ColdenJames number

You never have to give out your own cell. Customers only ever see
(318) 666-6445.

**When a customer texts ColdenJames**, it arrives on your cell like this:

> ColdenJames: new text from +1 318-555-0142: "Can you call me back about a fence repair quote?" Reply STOP to opt out.

**To answer them, text ColdenJames — (318) 666-6445 — from your cell.**
Save it in your contacts as "ColdenJames" so it is easy to find.

- **Just type your reply.** It goes to whoever last texted or called
  ColdenJames. Use this when you are answering the text you just got.
- **To pick who it goes to, start with their number.** Any of these work:
  `3185550142 See you at 9`, `318-555-0142 See you at 9`,
  `(318) 555-0142 See you at 9`, `+1 318 555 0142 See you at 9`.
  The number is taken off; they only see "See you at 9".
- Your words go exactly as you typed them. Nothing is added.
- If it went, you hear nothing back. If it didn't, you get one short line
  telling you why:
  - "Not sent: that number hasn't contacted ColdenJames." — you can only
    text people who called or texted ColdenJames first. That is the rule
    the texting approval depends on, so there is no way round it.
  - "Not sent: nobody has called or texted ColdenJames yet."
  - "Not sent: that number has replied STOP." — they have opted out.
  - "Not sent: there was no message after the number."
  - "Not sent: Twilio refused the message." or "…couldn't check the call
    and text log. Try again." — try again in a minute.
- **Careful with "last person".** If two people are in touch at once,
  start with the number so the reply goes to the right one.
- **Never text STOP, START or HELP to ColdenJames yourself.** Twilio acts
  on those words for your own cell — STOP would stop ColdenJames texting
  you. They are never passed on to a customer.

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

## What the caller hears

Recordings in the ColdenJames voice (ElevenLabs, "Alice"), served from
`public/audio/` on the same deployment, not Twilio's built-in voice. The
wording lives in `lib/texting-copy.js`; after changing it, run
`node scripts/make-voice-recordings.js` (needs `ELEVENLABS_API_KEY` in
`finder/.env`) and commit the new files. A test fails if a recording no
longer matches its wording. The greeting is quoted word for word in the
texting campaign, so changing it means updating the campaign too.

Run the tests with `npm test` from the repository root. They never call Twilio.
