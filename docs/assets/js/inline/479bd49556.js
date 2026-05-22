/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 479bd49556.  Do not edit by hand. */
(function(){
    var hb=document.getElementById('hamburger'),mn=document.getElementById('mobileNav');
    if(!hb||!mn)return;
    hb.addEventListener('click',function(){
      var open=mn.classList.toggle('open');
      hb.setAttribute('aria-expanded',open?'true':'false');
      var b=hb.querySelectorAll('span');
      if(open){b[0].style.cssText='transform:rotate(45deg) translate(5px,5px)';b[1].style.cssText='opacity:0';b[2].style.cssText='transform:rotate(-45deg) translate(5px,-5px)';}
      else{b.forEach(function(s){s.style.cssText=''});}
    });
    mn.addEventListener('click',function(e){
      if(e.target.tagName==='A'){mn.classList.remove('open');hb.setAttribute('aria-expanded','false');hb.querySelectorAll('span').forEach(function(s){s.style.cssText=''});}
    });
  })();
