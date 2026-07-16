# NBD Pro — LIVE QA — Cleanup Manifest (2026-06-07)

Every `ZZ_QA_2026-06-07`-prefixed artifact created during this run, with how to purge it.
**Do NOT delete any of these until Jo signs off at the end of the run.**

### Cleanup status (2026-06-07, end of session)
- ✅ Theme restored to NBD default. ✅ Local test image deleted. ✅ Merged branch `qa-fixes-2026-06-07` deleted.
- ✅ **The 2 ZZ_QA pipeline leads (DirectSaveTest `W5VbLJAeFXoGPCku93yf` + AllowlistVerify `z1gJtie8n5RAnAQrpveo`) are now DELETED** — after Jo applied the H-5 claim fix, client `deleteDoc` succeeded for both. (Before the fix they were permission-denied.)
- ⛔ One-off ops script created: `functions/set-jd-claims.js` — safe to delete now that it's been run (or keep for reference).
- ⛔ The /inspect **public lead** + its **Gmail alert** (thread 19ea2cd1bfd3b46c) also remain — purge via Firebase console + Gmail.
- ℹ️ Recent-Activity entries for "0000 QA Test Ln" persist (activity-feed log isn't removed on lead delete — minor).

Safe-test contact used on all QA records:
- Email: `jonathandeal459@gmail.com`
- Phone: _(pending Jo's cell)_
- Address pattern: `0000 QA Test Ln, Batavia OH`

| # | Type | Label / ID | Location (collection / path) | How to delete | Created |
|---|------|------------|------------------------------|---------------|---------|
| 1 | Public lead | `ZZ_QA_2026-06-07 Test Roof` (0000 QA Test Ln) | Public-lead collection in Firebase project `nobigdeal-pro` (exact collection TBD — written by public-lead-submit.js; NOT visible in CRM pipeline) | Firebase console → find doc by name/email → delete | 11:56 ET |
| 2 | Gmail | Lead-alert email, thread `19ea2cd1bfd3b46c` | Jo's inbox (STARRED + "Leads" label) | Unstar / delete the thread in Gmail | 11:56 ET |
| 3 | Pipeline lead | `ZZ_QA_2026-06-07 DirectSaveTest` — doc id **`W5VbLJAeFXoGPCku93yf`** | `leads` collection (nobigdeal-pro), NEW LEAD stage. Created via direct `_saveLead` (C-1 diagnosis probe). | CRM Pipeline → open card → delete, or Firebase console by id | ~12:1x ET |
| 4 | Pipeline lead | `ZZ_QA_2026-06-07 AllowlistVerify` (0000 QA Test Ln, same phone) | `leads` collection (nobigdeal-pro), NEW LEAD stage. Created via UI Save button after live allowlist-fix injection (C-1 verification, "Create anyway"). Has `duplicateOf` → DirectSaveTest. | CRM Pipeline → open card → delete, or Firebase console | ~12:2x ET |
| 5 | Theme pref | Active theme changed to **Cyberpunk** (Phase 2 theme test) | Jo's appearance pref (nbd-theme / nbd_pro_theme) | Theme picker (palette icon) → NBD Original/Default — **restore before run end** | ~1:0x ET |
| 6 | Local file | `nbd-qa-roof-test.jpg` (generated test image, NOT uploaded — file_upload rejected it) | `C:\Users\jonat\nbd-qa-roof-test.jpg` | `Remove-Item` the file | ~12:4x ET |

---

## Outbound-send firewall ledger
Any message driven to the send boundary (and whether it was sent to Jo-only or cancelled).

| # | Channel | Flow | Recipient | Sent? | Evidence |
|---|---------|------|-----------|-------|----------|
| 1 | Email | lead-alert.js auto-fire on /inspect submit | jd@nobigdealwithjoedeal.com + jonathandeal459@gmail.com (Jo only — SAFE) | Yes (auto) | Gmail thread 19ea2cd1bfd3b46c |
