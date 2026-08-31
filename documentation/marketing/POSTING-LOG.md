# Posting log — what actually went out, and when

> Running record of published GBP/Facebook posts. Kits are drafts; this file
> is the truth of what shipped. Add newest at the top. Keeping this means the
> next session never has to guess whether a kit was posted.

## 2026-08-31 (Sun) — GBP, 2 of 4 from the [08-28 kit](gbp-post-kit-2026-08-28.md)

Driven live in Jo's Chrome with him present. Profile: No Big Deal Home
Solutions (5.0★, 28 reviews, 44 customer interactions). Previous post was
4 months old — this ended that gap.

**Prerequisite first: GBP service area.** The profile was at the hard cap of
**20/20 areas**, so the six Central-KY towns could not simply be added. Jo
chose the surgical swap: removed **Hyde Park, Cincinnati** (a neighborhood
already inside the "Cincinnati, OH" chip, so no real coverage lost) and added
**Lexington, KY**. Saved; Google showed "Your edit is pending, up to 10
minutes to be reviewed." The five ring towns (Georgetown, Nicholasville,
Winchester, Richmond, Versailles) remain claimed on the website and named in
the post copy — they are just not GBP chips. **Confirm the pending edit
went through on the next session.**

| Post | Status | Details |
|---|---|---|
| **3 — Central Kentucky announcement** | ✅ Published | Copy verbatim from the kit. Button: **Learn more** → `https://nobigdealwithjoedeal.com/areas/lexington-ky`. No photo (per kit). |
| **4 — End-of-summer storm check** | ✅ Published | Button: **Call now** (auto-filled (859) 420-7382). Photos: `damage-lifted-shingles.jpg` + `damage-chalk-marked.jpg`. **Jo edited the copy live** — "I'll look at it with the drone **or hands on — your choice. Free, honest, and no pressure**" replaced the kit's "with the drone — free, honest, no pressure." Better: it stops the drone reading as the only option. **Fold this into future storm copy.** |
| 1 — Designer duplex re-roof | ⏸ Staged for Tue/Wed | Jo's call: stagger per the [citation kit](citation-kit-2026-07.md)'s Tue/Wed-morning guidance. Photos: `brick-duplex-designer-reroof-2026-3, -1, -2`. Button: Call now. |
| 2 — Gutters + screens, priced honestly | ⏸ Staged for Tue/Wed | Photos: `cincinnati-oh-gutter-screens-2026-1, -3, -2`. Button: Call now. |

Facebook variants FB1/FB2 (pair with posts 1 and 2) are **not yet posted** —
they go with the Tuesday run.

### Mechanics worth knowing next time

- **The photo picker is a native OS dialog.** Browser automation cannot drive
  it — `file_upload` needs a `ref`, and the GBP composer's file input is not
  exposed in the accessibility tree. Working pattern: the agent composes
  everything (text, button, link/phone), copies the intended photos to the
  **Desktop**, and Jo clicks "Select images and videos" and picks them; the
  agent verifies the thumbnails appear, then clicks Post. Clean up the
  Desktop copies afterwards.
- **The GBP dialog does not respond to mouse-wheel scroll.** Drag its
  scrollbar thumb (right edge of the dialog) instead. A drag inside the body
  selects text rather than scrolling.
- The panel re-renders between full-window and modal layouts, and screenshots
  time out while it does — wait 5-10s and retake rather than re-clicking, or
  you will double-fire an action.
- Service areas cap at 20. Check the count BEFORE promising to add towns.
