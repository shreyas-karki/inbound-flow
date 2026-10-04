# Inbound Flow: Math Journeys lead router

MVP that qualifies every Math Journeys form submission and routes it in a few seconds:

```
Form → /api/submit → Salesforce match → Starbridge Account Score → rules / Claude (Level 1/2/3) → Salesforce write → Slack → next step on the page
```

| Outcome | What the visitor sees | What the team gets |
|---|---|---|
| Level 3 (district decision maker, or a Hot/Warm district with a real need) | Growth manager's booking calendar | Slack post with reason and Starbridge score |
| Level 2 (school leader / specialist with a real need) | BDR's discovery calendar | Slack post |
| Level 1 (general interest) | Thank-you message | Slack post with a ready-to-send email draft (week one: BDR sends by hand) |
| Existing customer or open US NB deal | "Your Innovamat contact will reach out" | Slack post naming the account/deal owner |

If Claude is slow (over 6s) or fails, the lead becomes Level 2 so nobody waits on a broken step.

## Run it locally

```bash
npm install
cp .env.example .env    # already done once; MOCK_MODE=true by default
npm run dev             # http://localhost:3000
npm test
```

In `MOCK_MODE=true` everything is fake and offline: sample accounts, sample Starbridge scores, a points-based scorer instead of Claude, Slack posts printed to the terminal. Try district names `Lakeview County Schools` (Level 3), `Oak Grove School District`, `Riverside Unified`, `Maplewood Public Schools` (existing customer) and `Cedar Falls ISD` (open deal).

## Going live, step by step

1. **Starbridge**: `STARBRIDGE_API_KEY` is already set in `.env` and tested. The router reads your "Account scoring" (Top Buyers) bridge: Account Score 0-100, Fit band, Signal band, competitors present, enrollment, math proficiency. Lookups take under a second.
1. **Claude**: set `ANTHROPIC_API_KEY`. Model defaults to `claude-opus-5-5` at low effort for speed (`CLAUDE_MODEL` to change).
2. **Salesforce**: ask RevOps for a Connected App with the OAuth client-credentials flow enabled and a run-as integration user. Set `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, then `MOCK_MODE=false`.
   - Keep `SF_WRITE_MODE=dry-run` at first: the router reads real data and logs the exact fields it *would* write (`sf_payload` in the logs). Flip to `live` once a few dry runs look right.
3. **Slack**: create an incoming webhook for the inbound channel and set `SLACK_WEBHOOK_URL`.
4. **Calendars**: create Google Calendar appointment schedules for the BDR and the growth manager and paste the booking-page links into `BDR_BOOKING_URL` / `GM_BOOKING_URL`.
5. **Deploy**: `npx vercel` (first time links the project), add the same env vars in the Vercel dashboard, then `npx vercel --prod`.
6. **Traffic**: send a share of campaign traffic to the new page with `utm_content=router_v1` and compare against the current page.

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
api/submit.ts        Vercel function (POST /api/submit)
lib/router.ts        The pipeline, timings and logging
lib/salesforce.ts    Lookup + contact upsert (live and mock clients)
lib/starbridge.ts    Starbridge Account Scoring lookup (Top Buyers bridge)
lib/score.ts         Claude scoring with zod-validated JSON, timeout fallback
lib/rules.ts         Hard rules that run before Claude
lib/slack.ts         Slack message + Level 1 draft
public/index.html    The landing page and form (RevOps field IDs)
dev-server.ts        Local server for npm run dev
```

## Known gaps (MVP)

- **Unbounce:** its webhook is server-to-server, so it can't show the calendar after submit. To use this flow on Unbounce, the page needs a small script that posts to `/api/submit` itself.
- **Calendar bookings don't post to Slack yet.** Google appointment schedules have no booking webhook. Add a Calendar API watch later, or move to Calendly/Chili Piper.
- **No rate limiting** beyond the honeypot and minimum fill time. Add Vercel Firewall rules or Cloudflare Turnstile if spam shows up.
- **Routing is one BDR + one GM.** Many US district accounts already have an owner. Routing to the account owner is the obvious next step.
