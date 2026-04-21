/**
 * Google Reviews widget — fetches cached reviews from the
 * getGoogleReviews Cloud Function and renders a rating summary plus
 * the latest 5 reviews into any element matching [data-nbd-google-reviews].
 *
 * Graceful degradation: if the endpoint is unavailable or returns no
 * data, the container hides itself so the static /review page still
 * reads clean.
 */
(function () {
  'use strict';

  const ENDPOINT = '/api/google-reviews';
  const STAR_FULL =
    '<svg viewBox="0 0 24 24" fill="#fbbc04" aria-hidden="true" width="16" height="16"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>';
  const STAR_EMPTY =
    '<svg viewBox="0 0 24 24" fill="#2d3748" aria-hidden="true" width="16" height="16"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>';

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function stars(n) {
    const whole = Math.round(n || 0);
    let html = '';
    for (let i = 0; i < 5; i++) html += i < whole ? STAR_FULL : STAR_EMPTY;
    return `<span style="display:inline-flex;gap:2px;vertical-align:middle">${html}</span>`;
  }

  function truncate(text, limit) {
    const t = (text || '').trim();
    if (t.length <= limit) return esc(t);
    return esc(t.slice(0, limit).trim()) + '&hellip;';
  }

  function renderReviewCard(review) {
    const name = esc(review.author || 'Google user');
    const photo = review.profilePhotoUrl
      ? `<img src="${esc(review.profilePhotoUrl)}" alt="" referrerpolicy="no-referrer" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`
      : `<div style="width:40px;height:40px;border-radius:50%;background:#e8e5e0;flex-shrink:0"></div>`;
    const when = esc(review.relativeTime || '');
    const text = truncate(review.text || '', 320);
    return `
      <div class="gr-card" style="background:#fff;border:1px solid #e8e5e0;border-radius:12px;padding:22px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          ${photo}
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:#142a52;font-size:.95rem">${name}</div>
            <div style="font-size:.78rem;color:#6b7280">${when}</div>
          </div>
          <div>${stars(review.rating)}</div>
        </div>
        <div style="font-size:.95rem;line-height:1.65;color:#4a4a4a">${text}</div>
      </div>`;
  }

  function renderAll(container, data) {
    const rating = data.rating || 0;
    const total = data.total || 0;
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    const profileUrl = data.profileUrl || '';
    const staleBadge = data.stale
      ? '<span style="font-size:.7rem;color:#6b7280;margin-left:8px">(showing last-known reviews)</span>'
      : '';

    if (!reviews.length) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:24px">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;text-align:center">
          <div style="display:inline-flex;align-items:center;gap:10px;background:#fff;border:1px solid #e8e5e0;border-radius:100px;padding:10px 20px">
            <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="#fbbc04" d="M5.84 14.09A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.43.35-2.09V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            <div style="text-align:left">
              <div style="font-weight:800;color:#142a52;font-size:.95rem">Google Reviews</div>
              <div style="font-size:.78rem;color:#6b7280">Live from our profile${staleBadge}</div>
            </div>
          </div>
          <div style="display:inline-flex;align-items:center;gap:10px">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#142a52;line-height:1">${rating.toFixed(1)}</div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <div>${stars(rating)}</div>
              <div style="font-size:.75rem;color:#6b7280">${total} review${total === 1 ? '' : 's'}</div>
            </div>
          </div>
          ${
            profileUrl
              ? `<a href="${esc(profileUrl)}" target="_blank" rel="noopener" style="font-size:.78rem;font-weight:700;color:#e8720c;text-decoration:none;letter-spacing:.06em;text-transform:uppercase">See all on Google &rarr;</a>`
              : ''
          }
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
          ${reviews.map(renderReviewCard).join('')}
        </div>
      </div>`;
  }

  async function load() {
    const container = document.querySelector('[data-nbd-google-reviews]');
    if (!container) return;

    container.innerHTML =
      '<div style="text-align:center;padding:32px;color:#6b7280;font-size:.9rem">Loading Google reviews&hellip;</div>';

    try {
      const res = await fetch(ENDPOINT, { credentials: 'omit' });
      if (!res.ok) throw new Error('bad_status:' + res.status);
      const data = await res.json();
      if (data && data.error) throw new Error(data.error);
      renderAll(container, data || {});
    } catch (err) {
      console.warn('[google-reviews] load failed:', err);
      container.style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
