# Derived assets — not in the original pack

`logo-white-accent.svg` is `../vector/logo-color.svg` with its single navy
fill (`#1d2e53`) recolored to white (`#ffffff`), orange (`#ba5529`) and gray
(`#4a4e57`) left untouched. The pack ships a `color` variant (navy+orange,
for light backgrounds) and a flat monochrome `white` variant (loses the
orange accent entirely), but nothing for "white main text + orange accent,
for dark backgrounds" — which is what the site's header/nav/footer (dark
navy `rgb(18,34,61)` background) actually needs, and what the pre-refresh
logo already was. Rasterized to `docs/assets/images/nbd-logo.png` at 600×308
(same dimensions as the color variant, so no HTML width/height attributes
needed changing to fix this — see
[SESSION-2026-09-14-brand-refresh-logo-favicon](../../../documentation/projects/SESSION-2026-09-14-brand-refresh-logo-favicon.md)'s
dated correction).
