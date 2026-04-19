#!/usr/bin/env node
/*
 * 5 blog posts use an older template (.post-header / .post-body / .post-intro /
 * .post-cta / .related-posts) that has no matching CSS, so they render unstyled.
 *
 * Instead of rewriting all 5 HTML files, inject a CSS shim that makes those
 * classes look like the working `.article-hero / .prose / .callout` styling.
 * One CSS file, five grateful blog posts.
 */
const fs = require('fs');
const path = require('path');

const TARGETS = [
  'docs/blog/can-i-keep-insurance-check-not-fix-roof.html',
  'docs/blog/does-homeowner-insurance-cover-hail-damage-ohio.html',
  'docs/blog/how-much-does-roof-cost-cincinnati-2026.html',
  'docs/blog/signs-your-roof-needs-replacement-vs-repair.html',
  'docs/blog/what-to-expect-roof-insurance-adjuster-visit.html',
];

const ROOT = path.resolve(__dirname, '..');

const SHIM_CSS = `
/* blog-template shim (injected) */
article > .post-header{background:var(--navy-dark,#142a52);padding:64px 5% 52px;margin:0 -5%;color:var(--white,#fff)}
article > .post-header{padding-left:max(5%,calc((100vw - 1200px)/2));padding-right:max(5%,calc((100vw - 1200px)/2))}
.post-meta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:18px;font-size:.78rem;color:rgba(255,255,255,.7)}
.post-tag{display:inline-flex;align-items:center;background:rgba(232,114,12,.18);border:1px solid rgba(232,114,12,.45);color:var(--orange,#e8720c);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:5px 13px;border-radius:20px}
.post-header h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2.4rem,5vw,3.8rem);color:#fff;line-height:1.02;letter-spacing:.02em;margin:0 0 16px;max-width:820px}
.post-byline{font-size:.88rem;color:rgba(255,255,255,.72);font-weight:500}
article > .post-body{max-width:760px;margin:0 auto;padding:52px 5% 32px;color:#1a1a1a}
.post-body .post-intro{font-size:1.08rem;line-height:1.75;color:#1a1a1a;margin-bottom:28px;font-weight:500}
.post-body h2{font-family:'Bebas Neue',sans-serif;font-size:1.9rem;color:var(--navy,#1e3a6e);letter-spacing:.03em;margin:44px 0 14px;padding-bottom:8px;border-bottom:3px solid var(--orange,#e8720c)}
.post-body h3{font-size:1.05rem;font-weight:800;color:var(--navy,#1e3a6e);margin:28px 0 10px}
.post-body p{font-size:.96rem;color:var(--gray-sub,#4a4a4a);line-height:1.78;margin-bottom:18px}
.post-body p strong{color:#1a1a1a;font-weight:700}
.post-body ul,.post-body ol{margin:0 0 22px 22px}
.post-body li{font-size:.96rem;color:var(--gray-sub,#4a4a4a);line-height:1.7;margin-bottom:8px}
.post-body li strong{color:#1a1a1a}
.post-body blockquote{background:rgba(232,114,12,.07);border-left:4px solid var(--orange,#e8720c);padding:18px 22px;margin:28px 0;border-radius:0 8px 8px 0;color:var(--navy,#1e3a6e);font-style:italic;font-weight:600}
.post-body a:not(.cta-btn):not(.cta-btn-outline){color:var(--orange,#e8720c);font-weight:600;border-bottom:1px solid transparent;transition:border-color .2s}
.post-body a:not(.cta-btn):not(.cta-btn-outline):hover{border-bottom-color:var(--orange,#e8720c)}
.post-cta{max-width:760px;margin:12px auto 40px;background:var(--navy-dark,#142a52);color:#fff;border-radius:14px;padding:36px 40px;text-align:center}
.post-cta h3{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;color:#fff;letter-spacing:.03em;margin-bottom:10px}
.post-cta p{font-size:.92rem;color:rgba(255,255,255,.8);line-height:1.6;margin-bottom:22px}
.post-cta .cta-btn{display:inline-flex;align-items:center;gap:8px;background:var(--orange,#e8720c);color:#fff;padding:13px 24px;border-radius:8px;font-weight:800;font-size:.88rem;text-decoration:none;margin:5px 6px;transition:background .2s}
.post-cta .cta-btn:hover{background:var(--orange-dark,#c45e08)}
.post-cta .cta-btn-outline{display:inline-flex;align-items:center;gap:8px;background:transparent;color:#fff;padding:13px 24px;border-radius:8px;font-weight:700;font-size:.88rem;text-decoration:none;border:1.5px solid rgba(255,255,255,.35);margin:5px 6px;transition:border-color .2s,background .2s}
.post-cta .cta-btn-outline:hover{border-color:#fff;background:rgba(255,255,255,.06)}
.related-posts{max-width:1200px;margin:48px auto 32px;padding:40px 5% 0;border-top:2px solid var(--light-gray,#e8e5e0)}
.related-posts h3{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;color:var(--navy,#1e3a6e);letter-spacing:.04em;margin-bottom:24px}
.related-posts .related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.related-posts .related-card{background:var(--off-white,#f5f3ef);border:1px solid var(--light-gray,#e8e5e0);border-radius:10px;padding:22px 24px;text-decoration:none;color:inherit;transition:border-color .2s,transform .2s}
.related-posts .related-card:hover{border-color:var(--orange,#e8720c);transform:translateY(-2px)}
.related-posts .related-title{font-size:.95rem;font-weight:800;color:var(--navy,#1e3a6e);line-height:1.35;margin-bottom:8px}
.related-posts .related-desc{font-size:.85rem;color:var(--gray-sub,#4a4a4a);line-height:1.55}
.related-posts .related-card:hover .related-title{color:var(--orange,#e8720c)}
.blog-footer{max-width:1200px;margin:24px auto 0;padding:32px 5%;text-align:center;color:rgba(0,0,0,.6);font-size:.85rem;border-top:1px solid var(--light-gray,#e8e5e0)}
.blog-footer .footer-logo{font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--navy,#1e3a6e);letter-spacing:.05em;margin-bottom:8px}
.blog-footer .footer-links{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin:14px 0}
.blog-footer .footer-links a{color:var(--navy,#1e3a6e);font-weight:600;font-size:.83rem;text-decoration:none}
.blog-footer .footer-links a:hover{color:var(--orange,#e8720c)}
@media(max-width:760px){
  .related-posts .related-grid{grid-template-columns:1fr}
  article > .post-header{padding:44px 5% 36px}
  .post-header h1{font-size:2rem}
  article > .post-body{padding:36px 5% 24px}
  .post-body h2{font-size:1.5rem}
  .post-cta{padding:26px 22px;margin:12px 5% 32px}
}
`;

let touched = 0;
for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  const orig = fs.readFileSync(file, 'utf8');
  if (/blog-template shim \(injected\)/.test(orig)) continue;
  if (!/<\/head>/.test(orig)) continue;
  const next = orig.replace(/<\/head>/, '<style>' + SHIM_CSS + '</style>\n</head>');
  fs.writeFileSync(file, next);
  touched++;
}
console.log(JSON.stringify({ touched }, null, 2));
