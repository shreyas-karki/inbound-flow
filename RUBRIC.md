# Thinking Math! Inbound Lead Rubric

How every "Explore Thinking Math! Samples" form submission gets a level, and what happens next.

| Level | Meaning | Who handles it | What the lead sees |
|---|---|---|---|
| **3: First Touch** | Decision maker with a reason to change now | Growth manager | Calendar to book a meeting |
| **2: Discovery** | Real interest, but not the decision maker or no WHY NOW yet | BDR | Calendar to book a discovery call |
| **1: Email** | No buying path yet | Email reply asking them to loop in a decision maker | Thank-you message |

Only a **First Touch** (a meeting with the decision maker) moves a deal forward. A **Discovery** call is with anyone else: champions, coordinators, sometimes teachers. It teaches us the reality on the ground and gets us to the decision maker.

The first thing we need to learn from any lead is **WHY NOW**: why this district would change, and why this year. Adoption timing and Starbridge signals are the best evidence.

---

## Step 1: Hard rules (no AI)

These are checked first, in this order. If one matches, the lead is decided here.

1. **Existing customer**: the Salesforce account label is `CUSTOMER` or `NEW CUSTOMER`. → Routed to the **account owner**. No AI reply.
2. **Open deal**: there's an open US NB opportunity. → Routed to the **deal owner**. No AI reply.
3. **Outside our markets**: country isn't the United States or Canada. → **Level 1**.
4. **Not a buyer**: role is Parent or Homeschooler, Press, Politician, University, or Consultant / Advisor. → **Level 1**.

Everything else is scored by Claude using steps 2–4.

---

## Step 2: Who is the person?

| Group | Roles | What they mean for the deal |
|---|---|---|
| **Decision maker** | Superintendent, Assistant Superintendent (incl. Instruction/Curriculum and Teaching and Learning), Chief Academic Officer, Curriculum Director, Director of Teaching & Learning, District Administrator, Principal | Decides what gets bought |
| **Champion** | Math / STEM Director, Math Director, Math / STEM Coordinator, Curriculum Coordinator, MTSS Coordinator, Title I Director, Director of Special Education, Vice Principal | Wants it and can reach the decision maker, but doesn't sign |
| **End user** | Teacher, Assistant / Special Ed Teacher, Interventionist, Instructional Coach, Math Coach, Math / Instructional Coach, Math TOSA | Buy-in matters at the demo; never moves a deal on their own |
| **Other** | Anything else | Claude places them in the closest group |

**Principals:** a principal decides for one building. In **NYC**, schools buy at building level, so an NYC principal is a full decision maker.

---

## Step 3: Is there a WHY NOW?

### Curriculum adoption timing (from the form)

"When is your district planning to adopt a new math curriculum?" This is the strongest WHY NOW signal. Core curriculum is usually chosen in spring for the next school year.

| Answer | Reading |
|---|---|
| SY26-27 or SY27-28 | **Adopting soon**: strong signal |
| SY28-29 or later | Early research: worth a conversation, not urgent |
| I'm not sure | Unknown: not penalized; rely on role and Starbridge |
| No plans yet / Already adopted | Weak signal |

### Starbridge Account Scoring

| Field | Reading |
|---|---|
| Account score (0–100) | 70+ strong · 40–69 middling · under 40 weak |
| Fit band | Weak / Moderate / Strong / Ideal: match to our ideal customer |
| Signal band | NoSignals / Cool / Warm / Hot / Blocked: how active the district is now (**Blocked** = a competitor holds the account) |
| Signal summary | What the district is doing. If they just committed to another core program, WHY NOW is weaker even for a senior contact |

A district is **hot** when the signal band is **Hot** or **Warm**, or the account score is **70+**.

---

## Step 4: Assign the level

### Level 3: First Touch (growth manager)
A **decision maker** AND any of:
- adopting soon (SY26-27 / SY27-28)
- hot district
- adoption "I'm not sure" at a district with **Strong** or **Ideal** fit

A **principal outside NYC** only reaches Level 3 when adopting soon or at a hot district. Otherwise Level 2.

### Level 2: Discovery (BDR)
- Any **champion**
- A **decision maker** with later, unknown, or no adoption plans at a district that isn't hot. The BDR's job is to find the WHY NOW.
- An **end user**, but **only** when the district is hot or they're adopting soon

### Level 1: Email
- An **end user** at a district that is not hot and not adopting soon (the default for teachers and coaches)
- Signs of a student, job seeker, or vendor

---

## Tie-breakers

- **Never** put an end user or champion at Level 3. A meeting with them is a Discovery, not a First Touch.
- Decision maker, torn between 2 and 3 → **pick 3**.
- End user, torn between 1 and 2 → follow the rule strictly: no hot district and no near-term adoption means **Level 1**.
- Every decision comes with a one-line reason (under 25 words) naming the deciding factor, e.g. *"Curriculum director adopting in SY27-28 at a Hot district: First Touch."*

---

*Source of truth: `prompts/rubric.md` (what Claude reads) and `lib/config.ts` / `lib/rules.ts` (role lists and hard rules). If you change those, update this page too.*
