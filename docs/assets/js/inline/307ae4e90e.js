/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 307ae4e90e.  Do not edit by hand. */
// ── MOBILE NAV ──
function toggleMobileNav(){
  const nav = document.getElementById('mobileNav');
  const hb = document.getElementById('hamburger');
  const open = nav.classList.toggle('open');
  const bars = hb.querySelectorAll('span');
  if(open){
    bars[0].style.cssText='transform:rotate(45deg) translate(5px,5px)';
    bars[1].style.cssText='opacity:0';
    bars[2].style.cssText='transform:rotate(-45deg) translate(5px,-5px)';
  } else {
    bars.forEach(b=>b.style.cssText='');
  }
}
function closeMobileNav(){
  document.getElementById('mobileNav').classList.remove('open');
  document.getElementById('hamburger').querySelectorAll('span').forEach(b=>b.style.cssText='');
}

// ── SMOOTH SCROLL ──
document.querySelectorAll('a[href^="#"]').forEach(link=>{
  link.addEventListener('click',e=>{
    const href = link.getAttribute('href');
    if(href==='#') return;
    const target = document.querySelector(href);
    if(target){
      e.preventDefault();
      const navH = document.getElementById('mainNav')?.offsetHeight || 70;
      const y = target.getBoundingClientRect().top + window.scrollY - navH - 12;
      window.scrollTo({top:y, behavior:'smooth'});
      closeMobileNav();
    }
  });
});

// ── BACK TO TOP ──
window.addEventListener('scroll',()=>{
  const btn = document.getElementById('backTop');
  if(btn) btn.classList.toggle('visible', window.scrollY > 400);
});
