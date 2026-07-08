# BiddersHub — CPD Staff Guide

Internal reference for the Central Procurement Department (CPD) staff portal.

## Roles

| Role | Can do |
|---|---|
| **CPD Administrator** | Everything below, plus manage staff user accounts and view the audit log |
| **CPD Officer** | Create/edit bids, approve, publish, close bids, review vendor accreditation, respond to inquiries, view the KPI dashboard |
| **Proponent** | Legacy role, currently no bid-related permissions — see note below |

Roles live in the `Users` sheet (column `Role`: `cpd_admin` / `cpd_officer` / `proponent`). There
are no passwords — whoever's email is in that sheet with `Status = Active` can sign in with an
emailed one-time code.

**Bid opportunities are posted by CPD only.** Requesting departments no longer draft their own bid
opportunities in the system — they coordinate with the CPD directly, and CPD staff post the
opportunity (including the template documents bidders need). The `proponent` role still exists in
the `Users` sheet for reference but currently has no actions available in the Bid Opportunities tab.

## One-time setup (whoever deploys this)

1. Open the script editor → Run menu → select `setup` → run it. This creates all sheets
   (`Users`, `Vendors`, `BidOpportunities`, `Inquiries`, `AuditLog`, `Config`) and seeds two test
   accounts in `Users`:
   - `toic.test@dlsl.edu.ph` — `cpd_admin`
   - `cpd.test@dlsl.edu.ph` — `cpd_officer`
2. Replace those with real staff emails (or add rows for additional staff) directly in the
   `Users` sheet before going live.
3. Uploaded documents (vendor accreditation, bid template documents, and vendor bid submissions)
   are stored in a Drive folder named "BiddersHub Documents" that the script creates and owns
   automatically the first time an upload happens — no manual folder setup needed.

## Signing in

Same as vendors: **Login** → enter your staff email → enter the 6-digit code sent to it.

## Bid opportunity workflow

```
Draft → Submit for Approval → Approved → Published → Closed
  ↑              │
  └── Reject ────┘
```

1. **Draft** — CPD staff creates a bid opportunity (**Bid Opportunities** tab → **+ New Bid
   Opportunity**): title, category, department, estimated budget, submission deadline,
   description, and the bid document templates bidders will need (RFQ/ITB and Terms of Reference
   are required; BOQ, Bid Form, Eligibility Checklist, Draft Contract, and Plans/Specs are
   optional). Save as draft or submit immediately.
2. **Submit for Approval** — moves the bid to the **Approvals** tab. Blocked until the required
   documents above are attached.
3. **Approve / Reject** — CPD reviews. Approve moves it to *Approved*, ready to publish. Reject
   sends it back to *Draft* with a reason.
4. **Publish** — makes the bid visible on the public bid board and open for accredited vendors to
   submit bids and ask questions. This is when the reference number (e.g. `ITB-2026-0001`) starts
   appearing in KPI turnaround calculations (Approved → Published time).
5. **Close** — once the submission deadline has passed, close the bid with an outcome: *Awarded*,
   *Cancelled*, or *No Award*. Closed bids stay visible on the public board for transparency and
   audit purposes.

## Reviewing bid submissions

Only **accredited (Approved)** vendors can submit a bid on a Published opportunity — the system
checks their live accreditation status at submission time, not just their login status. On a
Published or Closed bid, click **View Submissions** (in the Bid Opportunities tab) to see every
vendor's Technical Proposal, Financial Proposal, and any other supporting documents they attached,
each as a clickable link, in submission order.

## Reviewing vendor accreditation

**Vendor Accreditation** tab lists applications (filterable by status). Each row shows the
applicant's uploaded documents (PDF only) as clickable links — review them before deciding on a
Pending application:

- **Approve** — assigns a permanent accreditation number (e.g. `ACC-2026-0001`) and a 1-year
  validity date.
- **Request Changes** — for incomplete or incorrect submissions. Requires a note describing what's
  wrong; the vendor is emailed automatically and sees the same note on their status page, along
  with a form to replace just the affected documents — no full re-application needed. Resubmitting
  sends it back to Pending for another look. Use **Resend Reminder** on a Changes Requested row if
  the vendor hasn't acted yet.
- **Reject** — a hard stop. Requires a reason, which the vendor sees on their status page; they'd
  need to start a fresh application (with a new email verification) to try again.

### Adding already-accredited vendors directly

If you've already vetted a vendor outside the system (e.g. migrating an existing PhilGEPS list),
you don't need to make them go through the public application: use **+ Add Accredited Vendor** for
one at a time, or **Bulk Upload** for many at once. Both skip the application/OTP flow and set the
vendor straight to Approved with an accreditation number assigned immediately.

For Bulk Upload, paste rows (tab-separated, as copied from a spreadsheet, or comma-separated) in
this order: `Company Name, Trade Name, Business Category, TIN Number, DTI/SEC Reg, Contact Person,
Contact Number, Email, Address`. Only Company Name, Contact Person, Contact Number, and Email are
required. A header row is fine — it's detected and skipped. Each row is processed independently, so
one bad row won't block the rest; failures are listed with the reason after import.

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

**Staff Users** tab: **+ Add Staff User** opens a form for email, name, role (CPD Administrator /
CPD Officer / Proponent), and department. **Edit** on any row opens the same form pre-filled —
email can't be changed once created, but name, role, department, and status (Active/Inactive) can.
Toggling status to Inactive there has the same effect as **Deactivate**, and switching it back to
Active reinstates sign-in access without recreating the account or losing its history.

Note: vendor accounts are managed separately under the **Vendor Accreditation** tab (see above) —
they carry accreditation-specific fields (documents, status, expiry) that don't fit the staff Users
sheet, and vendors sign in through their own portal rather than this staff role list.

## Audit log (Admin only)

Every login, create, approve, publish, close, and review action is logged with actor email, role,
and timestamp — satisfies the Data Privacy Act (RA 10173) data-logging requirement. Read-only,
last 150 entries shown.
