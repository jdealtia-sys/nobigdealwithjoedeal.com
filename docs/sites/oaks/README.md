# Oaks Roofing & Construction — website

A complete, self-contained static website. No build step, no framework, no
server code. Every file you need is in this folder.

Built 2026-08-19 as a rebuild of the previous oaksroofingandconstruction.com,
reconstructed from archived copies of the old pages.

---

## What's here

```
index.html              Home
about.html              Who We Are
service-areas.html      Service Areas
gallery.html            Our Work
contact.html            Contact Us
privacy.html            Privacy Policy
services/
  roof-replacement.html
  roof-repair.html
  siding-replacement.html
  siding-repair.html
  gutter-replacement.html
assets/
  css/site.css          all styling (one file)
  js/site.js            menu, gallery lightbox, form (one file)
  img/                  logo + every photo, as .webp with .jpg/.png fallbacks
logo-orange.svg         logo mark, vector
```

## How to put it online

Upload the **contents of this folder** to your host's web root (often called
`public_html`, `www`, or just the site root). That's it — `index.html` becomes
your home page.

It works on essentially anything: cPanel/shared hosting, Netlify, Cloudflare
Pages, GitHub Pages, Vercel, S3, or a plain Apache/nginx box. Nothing needs to
be installed or configured.

Every link inside the site is **relative**, so the folder works at a domain
root or inside a subfolder without editing anything.

---

## Three things to do before launch

### 1. Connect the quote form

The form appears on Home, About, Service Areas and Contact. Right now it
validates, then tells the visitor to call — it does not silently pretend to
send. Open **`assets/js/site.js`** and edit the config block at the top:

```js
var CONFIG = {
  formEndpoint: '',   // a POST endpoint, if you have one
  formEmail: '',      // or just your email address
  ...
};
```

- **Simplest:** put your email in `formEmail`. Submitting then opens the
  visitor's mail app with every field filled in, addressed to you.
- **Better:** sign up for a form service (Formspree, FormSubmit, Basin, or your
  host's own form handler) and paste its URL into `formEndpoint`. Leads then
  arrive by email without the visitor doing anything extra.

Until one of those is set, the phone number is the working contact route — and
it is on every page, in the header, the footer, and beside every form.

### 2. Turn on search engines

Every page currently carries this line in its `<head>`, which tells Google to
**stay away**:

```html
<meta name="robots" content="noindex, nofollow">
```

That is deliberate — it stops this copy competing with your real site while it
is staged. **Delete that line from all 11 pages when you go live.**

While you're in each `<head>`, uncomment the two lines below it and swap
`https://example.com` for your real domain:

```html
<link rel="canonical" href="https://example.com/...">
<meta property="og:url" content="https://example.com/...">
```

Those control which URL Google treats as official, and what shows up when
someone shares a link on Facebook or in a text message.

### 3. Check the Privacy Policy

`privacy.html` is an honest, plain-English starting point describing what this
site actually does (a form, no trackers, no cookies beyond one that remembers
you closed the top banner). Have someone you trust read it, and add a contact
email once you have one.

---

## Editing content

Everything is plain HTML — open a page in any text editor and the words are
right there. Some notes:

- **Phone number** appears in several places per page. It's written twice each
  time: once as visible text `(513) 827-5297`, once as a link
  `tel:+15138275297`. Change both.
- **Colors and fonts** are all at the top of `assets/css/site.css` under
  `:root`. The brand orange is `#fa6404`, taken from your logo.
- **Photos** live in `assets/img/`. Most are saved twice — a `.webp` (smaller,
  modern browsers) and a `.jpg` (fallback). If you replace a photo, replace both,
  or delete the `<source>` line and keep only the `.jpg`.
- **`logo-white.png`** is not used by any page. It's the all-white version of your
  logo, recovered alongside the orange one — keep it for dark photos, shirts,
  vehicle wraps, or anywhere the orange wordmark won't read.
- **The header, footer and top banner** are copied into every page rather than
  shared from one file. That's what makes the site work anywhere with no build
  step — the trade-off is that a change to the menu must be made in all 11
  pages. Search-and-replace across files handles it.
- **The service-area map** (`assets/img/service-area-map.jpg`) is an image, not
  a live map. Replace it if your coverage changes.

## Adding gallery photos

In `gallery.html`, copy one `<button>` block and point it at your new image.
Each tile needs a full-size file and a cropped thumbnail:

```html
<button type="button" data-full="assets/img/NEW.jpg" data-alt="What the photo shows">
  <picture>
    <source srcset="assets/img/NEW-thumb.webp" type="image/webp">
    <img src="assets/img/NEW-thumb.jpg" alt="What the photo shows" width="760" height="570" loading="lazy">
  </picture>
</button>
```

Thumbnails are 760×570. The lightbox picks up new tiles automatically.

---

## Notes

- The site needs no JavaScript to be readable. JS only powers the mobile menu,
  the gallery lightbox, the "Load More" areas button, and the form.
- All content and photography came from your previous site. No claims, prices,
  warranties, or credentials were invented — the only figures used are the ones
  the old site published (5-year labor warranty, 30-year shingle warranty,
  50-year siding warranty, 5.0/5.0 from 13 customers).
- Tested at desktop, tablet and phone widths, in light and dark system themes.

Questions: Jo Deal — No Big Deal Home Solutions.
