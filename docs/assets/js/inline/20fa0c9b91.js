/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 20fa0c9b91.  Do not edit by hand. */
(function(){
  var b=document.getElementById('stormBanner'),t=document.getElementById('stormBannerText');
  if(!b||!t)return;
  var m=new Date().getMonth();
  // Mar-Jun = storm season (urgent), Jul-Feb = off-season (maintenance)
  if(m>=2&&m<=5){
    t.innerHTML='\u26A1 Recent Storm? Free Emergency Roof Inspection \u2014 Call Joe Now: (859) 420-7382';
    b.style.display='block';
  } else if(m>=6&&m<=9){
    t.innerHTML='\u2600\uFE0F Summer is the best time for roof replacement \u2014 Schedule your free inspection today';
    b.style.display='block';
  } else {
    t.innerHTML='\u2744\uFE0F Protect your home before winter storms \u2014 Free roof inspection: (859) 420-7382';
    b.style.display='block';
  }
})();
