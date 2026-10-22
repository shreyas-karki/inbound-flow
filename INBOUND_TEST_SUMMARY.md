# Tiered inbound test: what's been built

*Status as of October 13, 2026. Secrets (TIER_SECRET, Vercel bypass) are not in this file.*

## The idea in one paragraph

Today every samples request goes through Make scenario 172177 the same way: about 18 Make credits, a Salesforce write, a Slack alert, and then someone reads it and follows up by hand. The test arm grades every lead the moment it's submitted (Level 0–3), shows good leads a calendar right on the page, routes each one to the right person (state BDR, state First Touch owner, or account owner), and keeps junk out of Salesforce and Slack. Both run side by side: today's page and 172177 are untouched (control), and a copy of the page feeds the new flow (test). We compare them weekly on speed to lead, meetings booked, held rate, and cost per lead.

## How a submission flows now

```
Lead submits forms.innovamat.com/request-samples-2/ (Unbounce)
 ├─ Unbounce webhook → Make "US Physical Samples — Tiered (Prynce)"
 │     → asks the app: POST inbound-flow.vercel.app/api/tier
 │     → Level 0: Iterable only (no Salesforce, no Slack)
 │     → Level 1+: 172177's Salesforce steps (Contact, Campaign Member), owner = app's host
 │     → Level 2+: Salesforce Task + Slack post (team format, level/reason/Starbridge on top)
 │     → everyone: Iterable (inbound_level) → nurture sub-scenario 104631 (unchanged)
 └─ Redirect script → app page → /api/submit → shows the next step:
       Level 3: First Touch owner's calendar · Level 2: state BDR's calendar
       Level 0–1: "check your email" · existing customer/deal: "your contact will reach out"
```

The page and Make ask the app about the same lead within seconds; the app scores it once and both get the same answer (shared cache in Upstash Redis), so the calendar the lead sees always matches the level in Slack.

## What was built

### 1. The app (Vercel, repo `inbound-flow`, deployed from `main`)

| Piece | What it does | Where |
|---|---|---|
| `/api/tier` | Make's endpoint. Needs header `x-inbound-secret`. Returns level, route, reason, host (name + Salesforce user ID), booking URL, Starbridge, Slack text, `slack_header`, errors and timings. Any failure answers Level 2 with `fallback: true`. | `api/tier.ts`, `lib/tier.ts` |
| `/api/submit` | The page's endpoint (lead's browser after redirect). Same decision. | `api/submit.ts`, `lib/router.ts` |
| `/api/warm` | Called by the page when a district is picked. Looks the district up in Starbridge before submit and caches it for a day. Cuts the wait after submit from ~8–10s to ~1.5–3s. | `api/warm.ts`, `lib/warm.ts` |
| Decide once | One decision per lead (email + role + adoption timeline), kept 2 hours; failed scorings kept only 2 minutes. | `lib/decisions.ts` |
| `ACTIONS_OWNER=make` | The app decides and shows the page but never writes Salesforce, posts to Slack or drafts emails. Make does. | `lib/config.ts` |
| Routing sheet reader | Reads the "Mapping Owners for Inbounds" sheet (3 tabs, published as CSV), cached 10 min. Expands `calendar.app.google` short links, handles `/u/0/` links and multi-schedule booking pages. | `lib/calendars.ts` |
| Unbounce field mapping | Accepts Unbounce field IDs (`first_name`, `user_profile`, `message`, …), array-wrapped or not; matches the form's "Name - City, County" school value. | `lib/unbounce.ts`, `lib/salesforce.ts` |
| Slack format | Same layout as the team's "New physical sample request" posts, with level, reason, calendar line and Starbridge on top. Competitors left out. | `lib/slack.ts` |
| Tests | 70+ tests (`npm test`), plus `scripts/try-tier.sh` to send sample leads to any deployment. | `test/`, `scripts/` |

### 2. Routing logic

**Order of decisions** (`lib/rules.ts`, then Claude with `prompts/rubric.md`):
1. Existing customer or open US NB deal → **account/deal owner** (no calendar).
2. Outside US/Canada, or a non-buyer role (parent, press, …) → **Level 0**.
3. **GM fast lane** (rule, no Claude): anyone who isn't a teacher, at a **Hot** Starbridge district with **5,000+ students**, adopting **SY26-27 or SY27-28** → **Level 3 First Touch**.
4. Everyone else, scored by **Claude Sonnet 5.5** (low effort, ~1.5–2s):
   - Decision makers and champions with any WHY NOW (adopting soon, hot/warm district, active review) → Level 3.
   - Coaches and TOSAs → never below Level 2; Level 3 at a hot district *(your change, Oct 13)*.
   - Teachers/coaches whose message says they're on the adoption/instructional committee → Level 3.
   - Teachers with a real signal → Level 2; no signal → Level 1.

**Who follows up** (`resolveHost`):
- State comes from the form's State field (not on the form yet) → the Salesforce district's "(City, ST)" → Starbridge.
- Level 3 → `ft_owners` row for the state (or "Other"); calendar from `calendar_links`.
- Level 2 → `Mapping` row for the state (Luis / Neftali); calendar from `calendar_links`.
- No link yet → "someone will reach out", and Slack still alerts the owner.

**Example:** Curriculum Director, Pennsylvania district, Hot, 5,000+ students, adopting SY26-27 → Level 3 by the fast lane → Rob Baier's calendar on the page; Contact and Task owned by Rob; Slack says "shown Rob Baier's calendar · Also add: Manuel Méndez".

### 3. Make

- **New scenario:** "US Physical Samples — Tiered (Prynce)", ID **262495**, same folder as 172177, **on**. Built from 172177's blueprint; 172177 itself was never edited.
- **New webhook:** `https://hook.eu1.make.celonis.com/bs7lmzl41libq3hkdcqrshvr1d1fba5e`
- Changes vs 172177:
  - Asks the app first ("Ask the app" HTTP module); if it fails, Level 2 by default.
  - Level 0 route: Iterable only.
  - Account lookup now fetches owner, region, PARR and school count (fixes 172177's blank PARR line and owner fallback bug).
  - Contact/Task owner = the app's host first, 172177's sheet rule as fallback.
  - Slack + Task only for Level 2+; internal `@innovamat.com` tests never write to Salesforce.
  - New Contacts get the form's country, decision-maker flag, and the level + reason in the message.
  - Task gets the Aircall phone field; Iterable gets `inbound_level`.
  - **"SLACK TEST MODE" module = `true`**: every post goes to **#test-inbounds-channel**. Set to `false` at launch.

### 4. Unbounce test page

- Page: **TM Samples Form - US copy 1** → `https://forms.innovamat.com/request-samples-2/` (published, no ads yet).
- Webhook switched from 172177's to the new one (verified: test submissions run only the new scenario).
- Scripts (Javascripts, "Before Body End Tag"):
  - **Redirect** (`unbounce/redirect.html`): sends the lead to the app page after submit; passes `message` and `state` if present.
  - **School search** (`unbounce/school-search.html`): smarter matching ("Akron Public Schools" → "Akron City", "Plainfield … 202" → "Plainfield SD 202"), districts first, always offers "Use: …", warms Starbridge on pick.

### 5. Routing sheet ("US - Mapping Owners for Inbounds")

- `Mapping` — **unchanged** (172177 reads columns A and C).
- `calendar_links` — added rows: Luis, Neftali, Neha, Arnau Marlí, JT Hidalgo, Larry Dang, Chenoa Minkley, Prynce. Links added: Eric, Rob (new link), Arnau Marlí, Chenoa, Neha.
- `ft_owners` — **new tab**, Manuel's Oct 12 list, with Melina and Manuel moved to "also add":

| State | Lead books with | Also add | Link |
|---|---|---|---|
| CT, MA, NY | Eric Fontana | Chenoa Minkley | ✅ |
| IL | Neha Rao | Melina Gruber | ✅ |
| PA | Rob Baier | Manuel Méndez | ✅ |
| OH | Arnau Marlí | Eric Fontana, Chenoa Minkley | ✅ |
| IN | Neha Rao | Melina Gruber | ✅ |
| FL, GA | Arnau Marlí | Manuel Méndez | ✅ |
| MI, WI | Prynce Karki | Melina Gruber | ❌ |
| NC | Prynce Karki | Manuel Méndez | ❌ |
| NJ | Jose Tomas (JT) Hidalgo | Larry Dang, Melina Gruber | ❌ |
| Charters / privates | Larry Dang | Manuel Méndez | not used by the app yet |
| Any other state | Prynce Karki | Manuel, Melina, Eric, Arnau | ❌ |

### 6. Vercel settings (names only)

`TIER_SECRET`, `ACTIONS_OWNER=make`, `SHEET_MAPPING_CSV_URL`, `SHEET_CALENDARS_CSV_URL`, `SHEET_FT_OWNERS_CSV_URL` *(not set yet)*, `STARBRIDGE_TIMEOUT_MS=7000`, `ANTHROPIC_API_KEY` + `ANTHROPIC_WORKSPACE_ID` (user-level key), Upstash Redis (`KV_REST_API_*`), Salesforce login vars, `BDR_BOOKING_URL` / `GM_BOOKING_URL` (Calendly stopgaps, fallback only).

## Verified end to end

- Internal test through the live page: redirected to the calendar screen; only the new scenario ran; one post in #test-inbounds-channel; nothing written to Salesforce.
- Real Starbridge data comes through (e.g. Akron: score 84/100, Hot, K-8 adoption RFP this year).
- Warm-up: district picked → decision in **1.4s** (vs ~10s cold).
- Slack post matches the team's existing layout with the decision header on top.

## Findings worth knowing

1. **The app can't log in to Salesforce** (`INVALID_SSO_GATEWAY_URL`: the login user is on SSO). So it can't spot existing customers or open deals, and can't give the state from the district. Example: Akron shows **$944K PARR**, so it's likely a customer and should go to its account owner, not a First Touch. Needs a RevOps integration user.
2. **Starbridge is slow** (4–7s per district search). Mitigated by the day-long cache and the warm-up.
3. **No State field on the form**, so the state often depends on Starbridge matching the district. When it doesn't, Level 3 falls to the "Other" row (Prynce).
4. **Iterable:** the nurture email comes from an Iterable journey triggered by the `form_answered` event; journeys may filter on the original page's ID/name/URL, so the test page needs to be added (and Level 0/1 emails built).
5. **172177 bugs** (left as is in production): account lookup only selected `Id` (owner fallback, blank PARR, California rule never firing); "Pacific" team (~5,100 accounts) has no Slack channel; country hardcoded on Contact create.
6. **Claude** usually takes ~2s; one run took >6s and fell back to Level 2.
7. **Make credits:** 172177 runs ~18 operations per lead; the new Level 0 path is much cheaper.

## Still to do

**Before real traffic**
1. Publish the `ft_owners` tab as CSV and set `SHEET_FT_OWNERS_CSV_URL` in Vercel (Production), then redeploy. Until then Level 3 uses the `GM_BOOKING_URL` fallback.
2. Calendar links: **Prynce** (MI, WI, NC, other states), **JT** (NJ), **Luis** and **Tali/Neftali** (Level 2 discovery). Paste into `calendar_links`; picked up within 10 minutes, no redeploy.
3. **Add a State dropdown** (field ID `state`) to the test page so routing by state is reliable. Optional: a free-text `message` field (the rubric's strongest signal, and needed for the committee escalation).
4. **Salesforce integration user** from RevOps (API-only, no SSO, read access to Contact/Account/Opportunity) → set the login vars in Vercel.
5. **Iterable:** separate journeys by `inbound_level` (0 = thank-you, 1 = long shot, 2–3 = today's nurture), and make sure the test page's `form_answered` events enter them.
6. **Rotate secrets** (`TIER_SECRET`, Vercel bypass): both appeared in chat. Update Vercel + Make.
7. **Re-add to `.gitignore`:** `*.blueprint.json` and `.env copy` (the lines are gone; the 172177 blueprint sits untracked in the repo folder and must not be committed).

**At launch**
8. Set "SLACK TEST MODE" to `false` in the Make scenario.
9. Maria points a share of test ads at `request-samples-2`.

**Soon after**
10. **SMS with Kixie:** instant text to the BDR/owner on every Level 2+ inbound (Make step after Slack).
11. **Bookings tracker:** Make scenario watching the hosts' Google Calendars → Salesforce Event + "Booked" Slack post.
12. Weekly A/B readout: speed to lead, booking rate by level, held rate, credits per lead.

## Decisions made along the way

- Stay on **Vercel** (not Railway): the app serves the lead's page and short API calls.
- **Code decides, Make acts**; 172177 never edited.
- **Google Calendar appointment pages**, not Calendly.
- **Nurture sub-scenario 104631 not changed** (shared); Iterable splits on `inbound_level` instead.
- **Melina and Manuel are never the lead booking**; they're added to the call.
- **Sonnet over Haiku** for scoring: the easy cases are rules now, Claude handles the judgment calls, and speed is dominated by Starbridge.
- **"Sizable" = 5,000+ students**, **Hot** signal band only for the fast lane (both in `lib/config.ts`).

## Where things live

- Step-by-step launch guide: `LAUNCH.md` · Technical details: `README.md` · Rubric: `prompts/rubric.md` (readable copy: `RUBRIC.md`)
- Routing sheet: https://docs.google.com/spreadsheets/d/1b5LplSnHAvp4AP1JqzHkPmOaHzayQJCDrwsqVZWRimY
- Test page: https://forms.innovamat.com/request-samples-2/ · App: https://inbound-flow.vercel.app
- Make: scenario 262495 (test) · 172177 (production, control) · 104631 (nurture sub-scenario)
- Slack: #test-inbounds-channel (`C0B5P4Z6CCC`)
