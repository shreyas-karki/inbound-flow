# Inbound Flow: Thinking Math! lead router

MVP that qualifies every Thinking Math! samples request and routes it in a few seconds:

```
Form → /api/submit → Salesforce match → Starbridge Account Score → rules / Claude (Level 1/2/3) → Salesforce write → Slack → next step on the page
```

| Outcome | What the visitor sees | What the team gets |
|---|---|---|
| Level 3 (district decision maker adopting soon, or a Hot/Warm district) | "Book directly with our growth team" + growth manager's calendar | Slack post with reason and Starbridge score |
| Level 2 (school leader / coach, or unsure) | "What does it look like?" 3-step path + BDR's discovery calendar | Slack post |
| Level 1 (general interest) | "Check your email!" | Slack post with a ready-to-send email draft (week one: BDR sends by hand) |
| Existing customer or open US NB deal | "Your Innovamat contact will reach out" | Slack post naming the account/deal owner |

If Claude is slow (over 6s) or fails, the lead becomes Level 2 so nobody waits on a broken step.

## Run it locally

```bash
npm install
cp .env.example .env    # already done once; MOCK_MODE=true by default
npm run dev             # http://localhost:3000
npm test
```

In `MOCK_MODE=true` everything is fake and offline: sample accounts, sample Starbridge scores, a points-based scorer instead of Claude, Slack posts printed to the terminal. Try a Curriculum Director at `Lakeview County Schools` adopting SY27-28 (Level 3), a Principal at `Oak Grove School District` (Level 2), a Teacher with no plans at `Riverside Unified` (Level 1), or `Maplewood Public Schools` (existing customer) and `Cedar Falls ISD` (open deal).

## Going live, step by step

1. **Starbridge**: `STARBRIDGE_API_KEY` is already set in `.env` and tested. The router reads your "Account scoring" (Top Buyers) bridge: Account Score 0-100, Fit band, Signal band, competitors present, enrollment, math proficiency. Lookups take under a second.
1. **Claude**: set `ANTHROPIC_API_KEY`. Model defaults to `claude-sonnet-5-5` at low effort for speed (`CLAUDE_MODEL` to change).
2. **Salesforce**: set `SALESFORCE_USERNAME`, `SALESFORCE_PASSWORD` and `SALESFORCE_SECURITY_TOKEN` (Salesforce → Settings → Reset My Security Token), then `MOCK_MODE=false`. `SALESFORCE_LOGIN_URL` defaults to `https://login.salesforce.com`. The router logs in with SOAP `login()` and uses the session for REST calls, so no Connected App is needed. Before going to production, switch to a dedicated integration user rather than a personal login.
   - Keep `SF_WRITE_MODE=dry-run` at first: the router reads real data and logs the exact fields it *would* write (`sf_payload` in the logs). Flip to `live` once a few dry runs look right.
3. **Slack**: create an incoming webhook for the inbound channel and set `SLACK_WEBHOOK_URL`.
4. **Calendars**: hosts and booking links come from the routing sheet (see [Routing sheet](#routing-sheet)). `BDR_BOOKING_URL` / `GM_BOOKING_URL` are only fallbacks for when the sheet has no link.
5. **Deploy**: `npx vercel` (first time links the project), add the same env vars in the Vercel dashboard, then `npx vercel --prod`.
6. **Traffic**: send a share of campaign traffic to the new page with `utm_content=router_v1` and compare against the current page.

## Tiered test: the app decides, Make acts

For the A/B test (steps in [LAUNCH.md](LAUNCH.md)), a new Make scenario receives the Unbounce webhook and asks this app for the decision, then does the Salesforce writes, Slack post, Task, SMS and Iterable sync itself.

- **`POST /api/tier`** takes `{ "data": <Unbounce data.json>, "page_url", "page_name" }` with the header `x-inbound-secret: $TIER_SECRET` (401 without it). It always answers 200 with a flat body: `level, route, meeting, reason, source, fallback, internal_test, decision_maker, state, host_name, host_user_id, also_add, booking_url, starbridge_*, sf_contact_id, sf_account_id, sf_match, open_opp_id, slack_text, cached`. On any failure it answers Level 2 with `fallback: true`.
- **Decide once.** The lead's browser (`/api/submit`) and Make both ask about the same lead within seconds. The first one scores it, and the second gets the cached answer, so the calendar on the page always matches the level in Slack. The cache is keyed on email + role + adoption timeline and kept for 2 hours in Upstash Redis (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`), or in memory when Redis isn't set.
- **`ACTIONS_OWNER=make`** stops this app from writing Salesforce, posting to Slack and drafting the AI reply. It still decides, shows the page and logs. The default `app` keeps today's behaviour.
- **Field names:** both endpoints accept Unbounce's field IDs (`first_name`, `user_profile`, `message`, …), array-wrapped or not. See `lib/unbounce.ts`.
- **Try it:** `scripts/try-tier.sh` sends each `test/fixtures/unbounce-*.json` to a running server. Locally the dev server's secret is `local-dev-secret`.

## Routing sheet

"US - Mapping Owners for Inbounds", each tab published to the web as CSV and cached for 10 minutes (`lib/calendars.ts`):

| Tab | Env var | Used for |
|---|---|---|
| `Mapping` (US State, Owner, User Long ID, …) | `SHEET_MAPPING_CSV_URL` | Levels 0-2: the state's BDR. Level 2 books on their calendar. |
| `ft_owners` (State, Owner, Owner ID, Also add) | `SHEET_FT_OWNERS_CSV_URL` | Level 3: the state's First Touch owner, plus who to add to the call |
| `calendar_links` (SF Long ID, SF Name, Calendar Link) | `SHEET_CALENDARS_CSV_URL` | Each person's Google appointment page, found by user ID, then by full name |

- **The lead's state** comes from the form, then the Salesforce district's "(City, ST)", then Starbridge. A state without a row uses the `Other` row.
- **Links:** `calendar.app.google` short links are expanded automatically. Full links work with or without `/u/0/`. A person without a working link gets "someone will reach out" instead of a calendar.
- **Careful:** Make scenario 172177 reads columns A and C of `Mapping`. Only add columns or tabs there.

## What it writes to Salesforce

Follows Innovamat's US inbound model (from the innovamat-salesforce knowledge base) and mirrors what the current Make integration writes:

- **Contact, never Lead.** Matched by email first. An existing contact is updated (Salesforce blocks duplicate emails).
- New contacts are created only when the district/school Account is matched unambiguously. The router never creates Accounts (that goes through Operations approval); unmatched leads are flagged in Slack with possible account names.
- Fields: `US_Inbound_Stage__c = New` (only if not already being worked), `isMQL__c = true`, `Inbound_Stage__c = Delivered`, `Role__c`, `Title`, `Decision_Maker__c`, `Contact_Source__c += Website`, `UTM_*_Last_Touch__c`, and `Inbound_Contact_Message__c` with the needs text plus the router's level and reason.
- Test data is always excluded (`Account.Label__c != 'TEST'`).
- The router does **not** touch `Inbound_Ou__c` (US Inbound Status). BDRs keep owning that qualification call.

## Editing the logic (no code changes needed)

- `prompts/rubric.md`: what makes a lead Level 1, 2 or 3. Claude reads this on every submission.
- `prompts/level1-email.md`: the Level 1 email draft posted to Slack.
- `lib/config.ts` → `rulesConfig`: customer labels, served countries, non-buyer roles, decision-maker roles.

## Project layout

```
api/submit.ts        Vercel function (POST /api/submit): the page and the Unbounce handoff
api/tier.ts          Vercel function (POST /api/tier): Make asks for the decision
lib/router.ts        The pipeline (decide, then act), timings and logging
lib/tier.ts          /api/tier: secret check, Make's response shape, fallback
lib/decisions.ts     Decide once per lead (Upstash Redis or in memory)
lib/calendars.ts     Routing sheet: state → BDR / First Touch owner → calendar
lib/unbounce.ts      Unbounce field IDs → ours
lib/salesforce.ts    Lookup + contact upsert (live and mock clients)
lib/starbridge.ts    Starbridge Account Scoring lookup (Top Buyers bridge)
lib/score.ts         Claude scoring with zod-validated JSON, timeout fallback
lib/rules.ts         Hard rules that run before Claude
lib/slack.ts         Slack message + Level 1 draft
public/index.html    The landing page and form (RevOps field IDs)
dev-server.ts        Local server for npm run dev
unbounce/redirect.html  Script for the Unbounce page: hands the lead to this app after submit
scripts/try-tier.sh  Sends the sample payloads in test/fixtures to /api/tier
```

## Known gaps (MVP)

- **Unbounce:** its webhook is server-to-server, so it can't show the calendar after submit. `unbounce/redirect.html` hands the lead to this app's page instead.
- **Calendar bookings don't post to Slack yet.** Google appointment schedules have no booking webhook. Planned: a Make scenario that watches each host's Google Calendar for new bookings.
- **No rate limiting** beyond the honeypot and minimum fill time. Add Vercel Firewall rules or Cloudflare Turnstile if spam shows up.
- **Charter and private schools** aren't detected yet, so they route by state like everyone else (see LAUNCH.md, "Who runs First Touches").

## Qualification and the AI SDR reply

Levels follow the US deal-stage framework (Discovery vs First Touch is defined by who is in the room):

| Level | Who | Meeting | Reply |
|---|---|---|---|
| 3 | Decision maker (CAO, curriculum director, asst. superintendent, superintendent; principal for one building / NYC) with a WHY NOW (adopting SY26-27/27-28 or a Hot/Warm district); coaches and TOSAs at a Hot/Warm district | First Touch with a growth manager | Direct walkthrough + sample drop-off |
| 2 | Champions (math director, coordinators, MTSS, Title I), decision makers without a WHY NOW yet, all other coaches and TOSAs, and teachers only at a hot district or with an evaluation signal | Discovery with a BDR | Short call, who else is involved |
| 1 | Teachers and interventionists with no WHY NOW | None | "We'll be in touch; loop in your principal/AP (NYC) or district curriculum lead" |

Role groups live in `lib/config.ts`; the rubric is `prompts/rubric.md`; the reply voice (Luis's state templates) is `prompts/sdr-reply.md`.

After the page responds, Claude drafts the reply in the background. With no Gmail API access, each draft comes with an **Open as Gmail draft** link (pre-filled compose window that Gmail saves as a draft). See every lead and draft at `http://localhost:3000/inbox`.

Per-service switches: `MOCK_SALESFORCE`, `MOCK_STARBRIDGE`, `MOCK_CLAUDE` override `MOCK_MODE`. User-level Claude keys (`sk-ant-usr-…`) also need `ANTHROPIC_WORKSPACE_ID`.
