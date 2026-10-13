/* Hotel tracker: no cookies, no form values, no personal data. Random per-tab session id only.
   Works as a plain <script>, via Google Tag Manager, or set window.HT_ENDPOINT / window.HT_SITE before loading. */
(function(){
var s=document.currentScript;if(!s){var all=document.getElementsByTagName('script');for(var i=0;i<all.length;i++)if(/tracker\.js/.test(all[i].src)){s=all[i];break}}
var site=(window.HT_SITE||(s&&s.getAttribute('data-site'))||location.hostname).replace(/^www\./,'').toLowerCase(),
base=window.HT_ENDPOINT||(s&&s.src?new URL(s.src).origin:''),E=base+'/collect',sid;
if(!base)return;
try{sid=sessionStorage.getItem('ht_sid');if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem('ht_sid',sid)}}catch(e){sid=Math.random().toString(36).slice(2)}
var dev=innerWidth<768?'mobile':'desktop',cl=[],maxd=0,t0=Date.now(),last='';
function send(t,d,x){var p=Object.assign({site:site,sid:sid,t:t,path:location.pathname,device:dev,d:d||{}},x||{});try{navigator.sendBeacon(E,new Blob([JSON.stringify(p)],{type:'text/plain'}))}catch(e){}}
function src(){var q=new URLSearchParams(location.search);
if(q.get('gclid')||q.get('gbraid')||q.get('wbraid'))return 'google-ads';if(q.get('fbclid'))return 'facebook-ads';if(q.get('msclkid'))return 'bing-ads';
if(q.get('utm_source'))return q.get('utm_source').toLowerCase();
try{var h=new URL(document.referrer).hostname.replace(/^www\./,'');if(h&&h!==location.hostname)return h}catch(e){}return 'direct'}
function pv(){if(last==location.pathname+location.search)return;last=location.pathname+location.search;var n=performance.getEntriesByType('navigation')[0];
send('pageview',{},{src:src(),load:n&&n.loadEventEnd?+(n.loadEventEnd/1000).toFixed(2):null})}
document.readyState=='complete'?setTimeout(pv,0):addEventListener('load',function(){setTimeout(pv,0)});
var ps=history.pushState;history.pushState=function(){ps.apply(this,arguments);setTimeout(pv,50)};addEventListener('popstate',function(){setTimeout(pv,50)});
document.addEventListener('click',function(e){var n=Date.now(),k=String(e.target.tagName+(e.target.id||'')).slice(0,60);
cl=cl.filter(function(c){return n-c.t<1000});cl.push({t:n,k:k});send('click',{el:k});
if(cl.filter(function(c){return c.k==k}).length>=3){send('rage_click',{el:k});cl=[]}},true);
addEventListener('scroll',function(){var d=Math.round(100*(scrollY+innerHeight)/document.documentElement.scrollHeight);
[25,50,75,100].forEach(function(m){if(d>=m&&maxd<m){maxd=m;send('scroll',{depth:m})}})},{passive:true});
document.addEventListener('invalid',function(e){send('form_error',{field:e.target.name||e.target.id||e.target.type})},true);
addEventListener('pagehide',function(){send('exit',{secs:Math.round((Date.now()-t0)/1000)})});
window.hotelTrack=function(t,d){send(t,d)};
})();
