# Evidence Decision Firewall — repeated-query inference and privacy controls (proposal)

No claim of noninterference is made. This document evaluates what a requester can learn by asking repeatedly, proposes
practical controls, and lists what stays observable. Nothing here is implemented yet.

## 1. What a query can reveal

The decision is a deterministic function of `(pinned snapshot S, grant G, request, now)`. Two facts follow.

* **The question space is small and closed.** The catalogue has 7 field items (two conclusion kinds each) and 3
  evidence types: at most **17 distinct questions per grant**. A requester can always enumerate every answer inside its
  own scope in 17 calls. Throttling cannot, and should not try to, prevent that: those answers are what the grant is for.
* **Repeating a question is idempotent.** For a fixed grant the answer changes only when `now` crosses an evidence
  expiry (already visible in authorised evidence) or the grant lapses. Hammering one grant yields no new information.

So the real inference exposure is **differencing**, not repetition:

| # | Threat | What leaks | Bounded by |
|---|---|---|---|
| T1 | Single-grant prober | nothing beyond the 17 in-scope answers | closed vocabulary, pin |
| T2 | Successive grants / snapshots | a verdict flip reveals that the owner's data changed (for example a PAN correction turns `NOT_CONFIRMED` into `CONFIRMED`, revealing that a hidden conflict existed) | each grant needs owner approval or an owner-created link; owner controls cadence |
| T3 | Colluding requesters | the same differencing, pooled | same |
| T4 | Out-of-scope probing | existence/absence of items outside scope | uniform `NOT_DISCLOSABLE`; probing counter |
| T5 | Timing and size | cost differences between paths | not controlled; no guarantee claimed |
| T6 | Rule inference | a requester who knows the public contradiction table can read `NOT_CONFIRMED` on a healthy-looking GSTIN as "PAN conflict or anomaly" | shared reason class (below) |

## 2. Controls

**C1 — Idempotent per-grant memo (process-local).** Key `(grantId, passportId, request, expiryBucket)`; repeated calls
return the identical object. This removes cost-based and flicker-based side channels and makes repetition provably
useless. It is an optimisation of an already deterministic function, not a security boundary.

**C2 — Throttling, applied before evaluation.**

| Scope | Limit (proposal, tunable) | Reason |
|---|---|---|
| per principal and grant | 30 / minute, 300 / day | well above the 17 legitimate questions |
| per principal, all grants | 600 / day | bounds multi-grant differencing effort |
| guest token | 60 / hour per token and 120 / hour per IP | tokens are bearer secrets; slows scraping |
| out-of-scope answers (`NOT_DISCLOSABLE`) per grant | more than 10 / hour → HTTP 429 and an owner notification | detects existence probing |

The limiter runs first, so a 429 never depends on the verdict. Counters are in-memory initially (single SQLite
instance); they reset on restart and do not span instances, which is acceptable for the current deployment and noted as a
limit.

**C3 — Response coarsening (default for requesters).**

| Engine verdict | Requester-visible `result` |
|---|---|
| `SUPPORTED` | `CONFIRMED` |
| `CONTRADICTED` | `CONFLICT_RECORDED` |
| `INSUFFICIENT_EVIDENCE` (every reason code) | `NOT_CONFIRMED` |
| `NOT_DISCLOSABLE` | `NOT_DISCLOSABLE` |

The response also carries the constant limitation text ("No external source was consulted…") and no reason code and no
snapshot version. Fine reason codes stay owner-side (audit). Collapsing the insufficiency reasons removes the one
requester-visible channel that distinguished a withheld hidden conflict from other causes; the requester can still compare
`NOT_CONFIRMED` with the pinned evidence lifecycle it already sees in Trust View, so the one-bit leak (L1) is reduced,
not removed.

**C4 — Optional bundle mode.** Evaluate a purpose-defined set (for example vendor onboarding: GSTIN supported, Udyam
supported, GST evidence current) and return one `CONFIRMED` / `NOT_CONFIRMED`. This lowers differencing resolution from
one bit per claim to one bit per purpose, at the cost of utility. Recommended as a later option, not the default.

**C5 — Audit and anomaly detection.** Every evaluation tied to a grant writes an owner-visible row (requester, grant,
request key, verdict, reason, snapshot version; never values). Rules: more than 10 `NOT_DISCLOSABLE` per grant per hour;
more than 100 evaluations per grant per day; evaluations across many grants by one requester in a short window. Triggers
an owner notification and is surfaced in the existing Audit Log. Retention follows the existing audit policy.

**C6 — Owner control.** Because grants are pinned and owner-approved, the owner already limits cadence and duration;
the Trust View copy should tell the owner that a requester can observe verdict changes between versions.

**C7 — Shape and size.** Constant response shape and similar size across verdicts. Timing equalisation is not attempted
and not relied on.

## 3. Resulting requester contract (coarsened)

```ts
type RequesterConclusion = {
  result: "CONFIRMED" | "CONFLICT_RECORDED" | "NOT_CONFIRMED" | "NOT_DISCLOSABLE";
  limitation: string;            // constant
};
```

## 4. What remains observable (accepted, documented)

1. **One withheld-conflict bit (L1).** `NOT_CONFIRMED` on an otherwise healthy claim means a hidden conflict, a
   field-level consistency failure, or a snapshot anomaly. The requester cannot tell which, but learns something is
   unconfirmable.
2. **Table inference (T6).** The contradiction table is public in the specification; a determined requester can reason
   from it.
3. **Cross-version differencing (T2/T3).** Verdict changes between grants reveal that data changed, and pooled
   requesters can combine observations. Not preventable without removing the feature.
4. **Complete in-scope enumeration.** All 17 answers are obtainable by design.
5. **Evidence existence and currency** for authorised evidence types and claims.
6. **Grant state** from `NOT_DISCLOSABLE` (scope, expiry, revocation, pin, assurance are merged but are the requester's
   own grant facts).
7. **Timing and cost** differences between paths; no guarantee.
8. **Anything the owner already authorised** through the ordinary Trust View.

## 5. Not claimed

No noninterference, no differential privacy, no timing guarantee, and no protection against requesters who legitimately
hold several grants and compare them. The controls make probing slower, noisier and visible to the owner; they do not make
it impossible.
