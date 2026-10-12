# Tiered inbound test: launch steps

## Purpose

Find out whether an automated funnel books more meetings, faster and for less money, than today's process does.

Today every samples request gets the same treatment. Make scenario 172177 writes it to Salesforce, emails it through Iterable and posts it to Slack, about 25 Make credits per lead, junk included. Then someone has to read each lead and call it back by hand.

The test arm sorts every lead into a level the moment it arrives and sends it down the matching path:
- Junk gets one email and costs almost nothing.
- Good leads see their BDR's or First Touch owner's calendar right on the page.
- The rep gets a Slack post and a text message.

We run both arms side by side (the A/B test agreed with Maria on Oct 8) and compare them every week.

## How it works

**The app decides, Make does the work.**

1. A lead fills in the **test page** (a copy of today's samples page that only the test ads point to).
2. **Make** receives the form and asks the **app on Vercel**: "How good is this lead?"
3. The app checks Salesforce and Starbridge, applies the rubric and answers with:
   - a **level**
   - **who follows up**
   - **which calendar** to show
   - a ready-made **Slack message**
4. Make acts on the level:

| Level | Who it usually is | What the lead sees | What Make does |
|---|---|---|---|
| **0** | Parent, vendor, student, outside the US | "Check your email" | Iterable thank-you email. Nothing in Salesforce, no Slack. |
| **1** | Long shot (e.g. a teacher with no adoption plans) | "Check your email" | Salesforce Contact + Iterable email asking who picks the math curriculum |
| **2** | Good lead | Their state's **BDR calendar** | Salesforce Contact + Task, Slack post, text to the BDR, Iterable nurture |
| **3** | Great lead (decision maker, buying soon) | Their **state's First Touch owner's calendar** | Same as Level 2, but for the state's First Touch owner, with a second person added (see [Who runs First Touches](#who-runs-first-touches)) |
| **Owner** | Existing customer or open deal | "Your contact will reach out" | Same as Level 2, but for the account or deal owner |

5. At the same time, the lead's browser asks the app the same question. The app scores each email once, so the calendar the lead sees always matches the level in Slack.
6. When someone books, a second Make scenario spots the meeting on the host's Google Calendar, logs it in Salesforce and posts "Booked" in Slack.

**What stays the same:** today's page and scenario 172177 aren't touched. They're the control arm.

## Where things stand (Oct 12)

- [x] Plan agreed
- [x] Make connector working in Claude Code. Claude can read 172177 and build new scenarios, so you don't need to export blueprints.
- [x] **Test scenario built (Oct 12), switched off:** "US Physical Samples — Tiered (test)", scenario 262495, in the same folder as 172177. Its new webhook is `https://hook.eu1.make.celonis.com/bs7lmzl41libq3hkdcqrshvr1d1fba5e`. 172177 was not touched.
- [x] Calendly code removed. The page shows Google appointment calendars.
- [x] First Touch owners by state, from Manuel (Oct 12). See below. 📌 **Three questions still open.**
- [x] The app's side of the test (Oct 12): `/api/tier` for Make, decide-once, routing from the sheet, form-field fixes, tests. See README, "Tiered test".
- [ ] **Booking links.** `calendar_links` already has working links for **Manuel Méndez, Melina Gruber, Rob Baier and Eric Fontana** (his short link works, since the app expands short links). **Still missing:** Luis, Neftali, Neha, Arnau Marli, JT, Larry. Until someone has a link, their leads see "someone will reach out within one business day", and the Slack alert still goes out right away.
- [ ] **Mobile numbers** for texts to reps. Not available yet.
- [ ] Everything below

## Who runs First Touches

> 📌 **ON HOLD: waiting on Manuel.** Don't build the `ft_owners` tab until the three questions at the end of this section are answered.
> The code is ready for it. Until the tab exists, Level 3 leads fall back to `GM_NAME` / `GM_BOOKING_URL` in Vercel, or to "someone will reach out" when that isn't set.
> When the answers come in: fill the tab (Step 2), publish it (Step 3), and remove this notice.

From Manuel Méndez, Oct 12. **The rule for every First Touch (Level 3): one owner per state.** The owner is on the call and decides who runs it. The "also add" person joins the call too.

| State | Owner (books the meeting) | Also add |
|---|---|---|
| Connecticut, Massachusetts | Eric | Chenoa |
| New York | Eric | Chenoa |
| Illinois | Neha | Meli |
| Pennsylvania | Rob | Manu |
| Ohio | Arnau Marli | Eric, Chenoa |
| Indiana | Melina | Neha |
| Michigan | Melina | Prynce |
| Wisconsin | Melina | Prynce |
| North Carolina | Manu | Prynce |
| Florida, Georgia | Manu | Arnau Marli |
| New Jersey | JT **and** Larry | Melina (for context) |
| Charter and private schools (any state) | Larry | Manu |
| **Any other state** | Manu | Slack Manuel with Prynce, Meli, Eric and Arnau tagged |

How the app and Make will use it:
- **The lead books with the owner.** Their booking link goes in `calendar_links`, once it exists.
- **The "also add" person** gets tagged in the Slack post. When a booking comes in, the bookings scenario adds them to the calendar event, because Google appointment pages can't invite a second person on their own.
- **Level 2 doesn't change.** Discovery calls still go to the state's BDR (Luis or Neftali) from the `Mapping` tab.
- This list goes in a **new sheet tab, `ft_owners`**, with the columns `State | Owner | Owner ID | Also add`.
  - **State:** full names or codes. One row can cover several, e.g. `Connecticut, Massachusetts`. Add one row named `Other` for every state not listed.
  - **Owner:** the person's full name, spelled exactly as in `calendar_links`. The app finds their booking link and user ID by that name, so **Owner ID** can stay blank for anyone already in `calendar_links`.
  - **Also add:** names, separated by commas.
  - A new tab is safe, because 172177 never reads it.

Before this can be built, someone needs to answer:
1. **New Jersey has two owners.** Whose calendar does the lead book on? Or should JT and Larry share one appointment schedule?
2. **Charter and private schools:** does Larry own them in every state, even New Jersey or New York? The app can tell them apart using the Salesforce account type and Starbridge.
3. **Full names:** who are "Manu" (Manuel himself?), "Meli" (the same person as Melina?), JT, Larry and Chenoa? Every person on the list needs a Salesforce user ID, and everyone who gets tagged needs a Slack member ID.

---

## Your steps

Do them in this order. Each step says why it matters, what to do, and how you know it's done. Claude's work runs alongside (see the next section).

### Step 1: Get the open decisions

**Why:** The routing and the launch date depend on these.

**Do:**
1. ~~Who runs First Touches~~ **Done.** Manuel's list is in [Who runs First Touches](#who-runs-first-touches).
2. **Ask Manuel** the three questions under that table: New Jersey's calendar, how charter and private schools work, and full names.
3. **Ask Maria:**
   - **Should we fix the bugs in today's scenario 172177 too, or only in the test one?** Owners fall back to the wrong person, Texas leads go to the default Slack channel, and PARR is always blank in Slack.
   - **How do we split the ad budget** between today's page and the test page?
   - **What's the launch date?**

**Done when:** you have answers to 2 and 3.

### Step 2: Clean up the routing sheet

**Why:** The app reads the sheet to pick each lead's host and calendar. Today 172177 also reads it, so a careless edit can break production.

**Do:** In [US - Mapping Owners for Inbounds](https://docs.google.com/spreadsheets/d/1b5LplSnHAvp4AP1JqzHkPmOaHzayQJCDrwsqVZWRimY):

⚠️ **Don't** rename the `Mapping` tab or move columns A or C. 172177 depends on them. Editing column D, column E, new columns, and the `calendar_links` tab is safe.

1. In `calendar_links`, add rows for **Luis Acevedo** (`005QD00000p42ViYAI`) and **Neftali Cuevas** (`005QD000013B8pdYAC`). This fixes the `#N/A` cells.
2. **Ramon Capell** has two rows. Delete one.
3. Add a row in `calendar_links` for each First Touch owner who doesn't have one yet: **Neha, Arnau Marli, JT and Larry** (Eric, Melina, Rob and Manuel already have rows). Put in the Salesforce user ID and full name, and leave the link empty for now.
4. 📌 **On hold until Manuel answers:** add the **`ft_owners` tab** described in [Who runs First Touches](#who-runs-first-touches). Claude can fill it in for you.
5. **Calendar links:** add them as they come (Step 4). Short `calendar.app.google` links are fine, because the app expands them.
6. **Mobile numbers:** when they exist, put them in a **new tab** called `mobiles` (columns: Salesforce user ID, name, mobile). Don't add them as column F of `Mapping`, as the original plan said: Step 3 publishes `Mapping`, and phone numbers shouldn't be on a public link. Make reads the new tab through its own Google connection.

**Done when:** every BDR and First Touch owner has one row in `calendar_links`. Links and mobiles can stay empty, and `ft_owners` waits for Manuel.

### Step 3: Set up Vercel

**Why:** The app needs a shared memory (Redis) so it scores each lead only once, plus a password so only Make can call it.

**Do:** In the `inbound-flow` project on Vercel:
1. **Add Redis:** Storage → Marketplace → **Upstash for Redis** → free plan → connect it to this project. Vercel adds the connection settings for you.
2. **Publish the sheet tabs as CSV:** in the sheet, File → Share → Publish to web. Pick `Mapping`, choose "Comma-separated values (.csv)" and click Publish, then copy the link. Do the same for `calendar_links`, and for `ft_owners` once it exists.
   - These links are readable by anyone who has them. They show names and Salesforce user IDs only (the mobiles live in the unpublished tab from Step 2).
   - If that's not OK, ask IT for a Google service account instead and tell Claude.
3. **Add these settings** (Settings → Environment Variables), for **Preview** only for now:

| Name | Value |
|---|---|
| `TIER_SECRET` | A long random password. Make one by running the command below. Make needs the same value, so keep it in your password manager. |
| `ACTIONS_OWNER` | `make` |
| `SHEET_MAPPING_CSV_URL` | the `Mapping` CSV link |
| `SHEET_CALENDARS_CSV_URL` | the `calendar_links` CSV link |
| `SHEET_FT_OWNERS_CSV_URL` | the `ft_owners` CSV link (publish it the same way) |

4. Check that the Salesforce, Starbridge and Anthropic settings the app already uses are set for **Preview** too.

```bash
openssl rand -hex 32
```

**Done when:** all five variables and Redis show under Preview. Don't send the secret to Claude in chat. Claude will ask you to paste it into Make yourself.

### Step 4: Set up the hosts' calendars

**Why:** Level 2 and 3 leads book straight onto these calendars, and the booking tracker reads them.

**Status:** booking links aren't available yet. This step doesn't block testing or launch, because Level 2 and 3 leads see "someone will call you" until a link is in the sheet. But the test measures speed to lead, so the sooner the calendars are in, the more the test tells us.

**Do:** For each host (the BDRs Luis and Neftali, and each First Touch owner in Manuel's list):
1. **Agree availability** with them: which days and hours, and how long the meetings are (10 minutes for BDR discovery calls, 45 for First Touch deep-dives).
2. **They set up an appointment schedule** in Google Calendar, if they don't have one, with those hours. Its description should explain the meeting, because the page shows only the calendar.
3. **Copy their booking-page link** (Share → copy link) into their row in `calendar_links`. Short `calendar.app.google/...` links and long `calendar.google.com/...` links both work.
4. **Calendar access:** they share their calendar ("See all event details") with the Google account that Make's Google Calendar connection uses. Claude will tell you which account that is.

**Done when:** every host row has a link, and opening each one shows open slots. Links can go in one at a time, and the app picks each one up within 10 minutes.

### Step 5: Build the Iterable emails

**Why:** Level 0 and Level 1 leads get **only** an email. If these emails don't exist at launch, those leads get nothing.

**Do:** Once Claude sends you the copy:
1. Find whoever owns Iterable and loop them in.
2. Create two templates:
   - **Level 0 thank-you:** free resources, no ask.
   - **Level 1 long shot:** digital samples plus "Who on your team chooses math curriculum?" Replies go to the BDR inbox.
3. Make the journey (or sub-scenario 104631) **split on the `inbound_level` field**: 0 → thank-you, 1 → long shot, 2 and 3 → today's nurture.

**Done when:** a test contact with `inbound_level = 0` receives the thank-you, and one with `1` receives the long-shot email.

Note: Claude's Iterable connector failed to connect in this session, so Claude can't check this side yet.

### Step 6: Set up text messages to reps

**Why:** A text reaches a BDR faster than Slack does. Speed to lead is the main thing we're measuring.

**Do:**
1. Check with whoever runs Aircall whether we have a number that can **send SMS through the API**, and get API credentials for it.
2. If Aircall can't do it, pick **Twilio** instead.
3. Add the credentials **directly in Make** (Connections → Add). Don't paste them in chat.

4. Collect each host's mobile number into the `mobiles` tab (Step 2). They aren't available yet.

**Done when:** a Make connection for Aircall or Twilio exists and the numbers are in. This step can come after launch, because Slack alerts cover the gap.

### Step 7: Review the Make scenarios Claude builds

**Why:** These scenarios write to Salesforce and message the team, so a person checks them before they go on.

**Do:** Open "US Physical Samples — Tiered (test)" (scenario 262495) in Make. Here's how it reads, left to right:
1. **Webhook** (new hook 106997, not 72008) → **Parse JSON**, same as 172177.
2. **"Ask the app"** (HTTP): posts the form to `/api/tier`. If the app fails or times out, it resumes with Level 2.
3. **"Decision (with fallbacks)"**: the app's answer as variables (level, host, reason, Slack text).
4. **"SLACK TEST MODE"**: set to `true`, so every Slack post goes to the test channel. Set it to `false` at launch (Step 10).
5. **Router:**
   - **Level 0:** Iterable (with `inbound_level`) → the nurture sub-scenario 104631. No Salesforce, no Slack.
   - **Everyone else:** 172177's steps, with these changes:
     - The account lookup now fetches owner, region, PARR and school count, so the owner sheet, the California rule and the PARR line work.
     - The Contact and Task owner is the app's host first, with 172177's rule as the fallback.
     - Slack and the Task are for Level 2+ only. Slack posts the app's message plus PARR, owner and the Contact link.
     - Internal `@innovamat.com` tests write nothing to Salesforce and post to the test channel.
     - New Contacts get the form's country, the decision-maker flag, and the router's level and reason in the message.
     - The new-Contact Task gets the Aircall phone field.
     - Iterable gets `inbound_level`.
     - Sub-scenario 104631 is called unchanged.

Then check that 172177 still looks exactly as it did.

**Paste the secret:** open "Ask the app" → Headers → replace `PASTE_TIER_SECRET_HERE` with the `TIER_SECRET` from Step 3. Until you do, every call gets a 401 and every lead falls back to Level 2.

**Done when:** you're happy with the canvas. Leave it **off** for now.

### Step 8: Make the test page in Unbounce

**Why:** Test ads need a page that sends leads to the new scenario and to the app.

**Do:**
1. **Duplicate the page as a new page with its own URL.** Don't make it a variant of the same page: Unbounce webhooks are set per page, so a variant would send leads to both scenarios.
2. On the new page, under Integrations → Webhooks, **remove the 172177 webhook** and add the new scenario's webhook: `https://hook.eu1.make.celonis.com/bs7lmzl41libq3hkdcqrshvr1d1fba5e`
3. Javascripts → Add New → placement "Before Body End Tag", and paste the script from [unbounce/redirect.html](unbounce/redirect.html). Claude will first point the script at the preview app for testing.
4. Publish the page, but don't put it in any ad yet.

**Done when:** submitting the new page lands you on the app page and shows a result.

### Step 9: Run internal tests

**Why:** Prove that every level goes the right way before real leads do.

**Do:**
1. Turn on the test scenario.
2. Submit the test page once for each case (Level 0, 1, 2, 3, and an existing customer) using `@innovamat.com` emails. Claude will give you a sheet of exact inputs for each one. Test leads are scored like real ones but flagged, so nothing gets written to Salesforce.
3. For each one, check that:
   - the page shows the right calendar, or the "check your email" screen
   - the Make run log shows the level and the route that ran
   - Level 0 ran no Salesforce step
   - there's exactly one Slack post, in the test channel
4. Book one slot on a host's calendar and check for the "Booked" post.

**Done when:** all five cases pass. Send Claude anything that looks wrong.

### Step 10: Go live

**Do:**
1. Confirm the Iterable emails from Step 5 are live.
2. In Vercel, add the same five settings from Step 3 for **Production**. Claude deploys to production (with your OK) and switches the Unbounce script to the production app.
3. In Make, open "SLACK TEST MODE" in the test scenario and change `true` to `false`, so posts go to the team channels.
4. Ask Maria to point the test ads at the new page.

**Done when:** the first real lead shows up in Slack with a level.

### Step 11: Weekly readout

Every week, compare the two arms on:
- **Speed to lead:** time from form to first call or booking
- **Booking rate**, by level
- **No-show rate**
- **Make credits per lead**

---

## What Claude does alongside you

| When | Claude's work |
|---|---|
| ✅ Done Oct 12 | Built the app's scoring endpoint for Make, decide-once memory, calendar routing from the sheet and form-field fixes, with tests. README updated. |
| Now | Writes the Level 0 and Level 1 email copy for Step 5. |
| ✅ Done Oct 12 | Built the test scenario in Make (off), for Step 7. |
| After your Steps 1–3 | Deploys the app to a Vercel preview (each deploy only with your OK), and points the scenario's "Ask the app" at it for testing. |
| After your Step 4 | Builds the "Inbound bookings" scenario. |
| Before your Step 9 | Sends the test inputs for each level. |

## Open questions to settle along the way

- **Slack channel for the "Pacific" team:** about 5,100 US accounts have `Team__c = Pacific`, and like 172177, the test scenario sends them to the default channel. Texas has only one account, so it doesn't need its own case.

- 📌 **Manuel's three questions** in [Who runs First Touches](#who-runs-first-touches): New Jersey's two owners, charter and private schools, and full names and IDs.

- **Canada:** the app counts Canada as a served country, but the plan says every non-US lead is Level 0. Which one is right?
- **Pre-filling the calendar:** Google appointment pages can't pre-fill the lead's details, so leads type their name and email again. The booking tracker matches bookings to Salesforce by email, so a lead who books with a different email won't be matched.
