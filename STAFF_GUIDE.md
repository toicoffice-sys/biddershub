# BiddersHub — CPD Staff Guide

Internal reference for the Central Procurement Department (CPD) staff portal.

## Roles

| Role | Can do |
|---|---|
| **CPD Administrator** | Everything below, plus manage staff user accounts and view the audit log |
| **CPD Officer** | Create/edit bids, approve, publish, close bids, review vendor accreditation, respond to inquiries, view the KPI dashboard |
| **Proponent** | Draft bid opportunities for their own department and submit them for CPD approval — cannot approve, publish, or review vendors |

Roles live in the `Users` sheet (column `Role`: `cpd_admin` / `cpd_officer` / `proponent`). There
are no passwords — whoever's email is in that sheet with `Status = Active` can sign in with an
emailed one-time code.

## One-time setup (whoever deploys this)

1. Open the script editor → Run menu → select `setup` → run it. This creates all sheets
   (`Users`, `Vendors`, `BidOpportunities`, `Inquiries`, `AuditLog`, `Config`) and seeds two test
   accounts in `Users`:
   - `toic.test@dlsl.edu.ph` — `cpd_admin`
   - `cpd.test@dlsl.edu.ph` — `cpd_officer`
2. Replace those with real staff emails (or add rows for additional staff) directly in the
   `Users` sheet before going live.
3. Uploaded documents (vendor accreditation + bid attachments) are stored in the shared Drive
   folder configured in `Code.js` (`UPLOAD_FOLDER_ID`) — confirm your account has edit access to it.

## Signing in

Same as vendors: **Login** → enter your staff email → enter the 6-digit code sent to it.

## Bid opportunity workflow

```
Draft → Submit for Approval → Approved → Published → Closed
  ↑              │
  └── Reject ────┘
```

1. **Draft** — Proponent or CPD staff creates a bid opportunity (**Bid Opportunities** tab →
   **+ New Bid Opportunity**): title, category, department, estimated budget, submission
   deadline, description, and any bid documents (RFQ/ToR, forms). Save as draft or submit
   immediately.
2. **Submit for Approval** — moves the bid to the **Approvals** tab (CPD Officer/Admin only).
3. **Approve / Reject** — CPD reviews. Approve moves it to *Approved*, ready to publish. Reject
   sends it back to *Draft* with a reason.
4. **Publish** — makes the bid visible on the public bid board. This is when the reference number
   (e.g. `ITB-2026-0001`) starts appearing in KPI turnaround calculations (Approved → Published
   time).
5. **Close** — once the submission deadline has passed, close the bid with an outcome: *Awarded*,
   *Cancelled*, or *No Award*. Closed bids stay visible on the public board for transparency and
   audit purposes.

## Reviewing vendor accreditation

**Vendor Accreditation** tab lists applications (filterable by status). Each row shows the
applicant's uploaded documents as clickable links — review them before deciding. **Approve**
assigns a permanent accreditation number (e.g. `ACC-2026-0001`) and a 1-year validity date.
**Reject** requires a reason, which the vendor sees on their status page and can use to correct
and re-apply.

## Responding to inquiries

**Inquiries** tab lists vendor questions on published bids. **Respond** to answer — once
answered, the Q&A becomes visible to all vendors on that bid's public detail page (helps everyone
who's considering bidding, not just the one who asked).

## KPI Dashboard

Live metrics computed from the sheets — no manual tracking needed:

- **% Published Within 1 Business Day** — share of bids published within 24 hours of CPD approval
- **Avg. Approval → Publish (hrs)** — average turnaround time
- Bid counts by status, accredited/pending vendor counts, total/open inquiries

## Managing staff users (Admin only)

**Staff Users** tab: **+ Add Staff User** prompts for email, name, role, and department.
**Deactivate** revokes sign-in access without deleting their history.

## Audit log (Admin only)

Every login, create, approve, publish, close, and review action is logged with actor email, role,
and timestamp — satisfies the Data Privacy Act (RA 10173) data-logging requirement. Read-only,
last 150 entries shown.
