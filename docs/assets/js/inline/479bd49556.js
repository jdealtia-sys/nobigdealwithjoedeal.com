/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 479bd49556.  Do not edit by hand (a11y update 2026-08-07: Escape
   closes the menu and returns focus to the hamburger; aria-label flips
   Open/Close; shared close path). Ships sitewide via the nav partials. */
(function(){
    var hb=document.getElementById('hamburger'),mn=document.getElementById('mobileNav');
    if(!hb||!mn)return;
    function setOpen(open){
      mn.classList.toggle('open',open);
      hb.setAttribute('aria-expanded',open?'true':'false');
      hb.setAttribute('aria-label',open?'Close menu':'Open menu');
      var b=hb.querySelectorAll('span');
      if(open){b[0].style.cssText='transform:rotate(45deg) translate(5px,5px)';b[1].style.cssText='opacity:0';b[2].style.cssText='transform:rotate(-45deg) translate(5px,-5px)';}
      else{b.forEach(function(s){s.style.cssText=''});}
    }
    hb.addEventListener('click',function(){
      setOpen(!mn.classList.contains('open'));
    });
    mn.addEventListener('click',function(e){
      if(e.target.tagName==='A'){setOpen(false);}
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&mn.classList.contains('open')){
        setOpen(false);
        hb.focus();
      }
    });
  })();
