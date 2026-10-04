# Inbound Flow: what it does and why

## The goal

Give Innovamat a better way to manage inbound leads. Every person who requests Thinking Math! samples should get the right next step within seconds, and the right person on our team should know about them with the context they need to act.

Today, inbound leads go through a Make integration that writes them to Salesforce. Someone then has to read each one, decide how serious it is, look up the district, and decide who follows up. That takes time, the decisions aren't always consistent, and a district leader who is ready to buy can wait just as long as a teacher asking for a worksheet.

Inbound Flow replaces that manual triage with an automatic one, while keeping the sales team in control.

## What happens when someone submits the form

1. **They fill out the form** on the "Explore Thinking Math! Samples" page: name, contact details, school district, role, and when their district plans to adopt a new math curriculum.
2. **We check Salesforce.** Is this person already a contact? Which district or school do they belong to? Is that account already a customer, or is there an open deal?
3. **We check Starbridge.** How good a fit is the district for Thinking Math!, and is it showing buying signals right now (curriculum reviews, RFPs, budget approvals)?
4. **We decide how qualified the lead is.** Clear cases are decided by fixed rules. Everything else is scored by Claude, using a written rubric that the sales team owns and can edit. The strongest signals are the person's role and their district's curriculum adoption timing.
5. **We update Salesforce** following our US inbound model: Contact (never Lead), the inbound stage, MQL flag, role, decision-maker flag, campaign source, and a note explaining the decision.
6. **We tell the team in Slack**, with the level, the reason, the Starbridge score and a link to the Salesforce record.
7. **The person sees their next step right away** on the page: a booking calendar, or a thank-you message.

The whole thing takes a few seconds.

## Lead levels and routing

| Level | Who it usually is | What the person sees | Who follows up |
|---|---|---|---|
| **Level 3** | District decision maker adopting in the next two school years, or anyone at a district that is actively buying | **"Book directly with our growth team"**: they skip the intro call and book the 45-minute deep-dive | Growth manager |
| **Level 2** (and anything unsure) | Principal, math coordinator or coach, district leader with later timing, teacher at a district that's adopting soon | **"What does it look like?"**: the three-step path below, starting with booking the 10-minute call | BDR |
| **Level 1** | Teacher with no adoption plans, outside our markets | **"Check your email!"**: digital samples sent by email | BDR sends a ready-made email draft posted in Slack |
| **Existing customer or open deal** | Anyone at an account we already work with | "Your Innovamat contact will reach out" | The account or deal owner |

The path every qualified lead follows:

1. **10-minute phone call with a math coach** (BDR discovery)
2. **A deep-dive into resources** with Digital Classroom Manager access (45 min)
3. **Shipment of samples** for curriculum review and a demo with teachers

Level 2 starts at step 1. Level 3 skips straight to step 2 with the growth team.

When unsure between two levels, the system picks the higher one. A rep can always step a lead down, but a serious lead sent the wrong way may not come back.

## What changes for each team

- **BDRs** stop sorting leads by hand. Each lead arrives in Slack already graded, with the reason and the district context. Level 1 leads come with an email draft ready to send.
- **Growth managers** get district decision makers booked directly onto their calendar, instead of waiting for a handoff.
- **Account and deal owners** are told right away when someone from their account comes in through the website, so a customer isn't treated like a new prospect.
- **RevOps** gets consistent Salesforce data: every inbound contact gets the same fields filled the same way, with campaign attribution and the reason behind each decision.
- **Marketing** can see which campaigns produce Level 3 leads rather than just form fills.

## Guardrails

- **Sales owns the logic.** What makes a lead Level 1, 2 or 3 is written in plain English in `prompts/rubric.md`. Hard rules (customer labels, served countries, non-buyer roles, decision-maker roles) live in `lib/config.ts`. Changing them doesn't require an engineer.
- **Nobody waits on a broken step.** If scoring is slow or fails, the lead defaults to Level 2 and goes to a BDR.
- **Salesforce rules are respected.** The system never creates Accounts (that stays with Operations), never creates duplicate contacts, always excludes test data, and doesn't touch the US Inbound Status field that BDRs own.
- **Safe rollout.** In dry-run mode the system reads real Salesforce data but only logs what it *would* write, so the team can review real decisions before anything changes in the CRM.
- **Every decision is explained.** Each lead carries a one-sentence reason in Slack and in Salesforce, so reps can see why it was graded the way it was and correct the rubric if it's wrong.

## Current status

This is an MVP for Thinking Math! in the US and Canada.

- Built and tested: the samples form (matching the live Thinking Math! page), Salesforce matching and writing, Starbridge scoring, Claude grading, Slack posts and the three result screens.
- Salesforce now connects with a username, password and security token.
- Before going live: run in dry-run mode on real traffic, review the decisions with the sales team, then switch to live writes and send a share of campaign traffic to the new page to compare against the current one.

## Possible next steps

- Route leads to the existing account owner instead of a single BDR and growth manager.
- Post calendar bookings to Slack once they happen.
- Extend the flow to other products (such as Math Journeys) and markets.
- Add spam protection if bot traffic shows up.
