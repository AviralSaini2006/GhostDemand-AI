// Zero-dependency collector + analysis + dashboard server. Node >= 18.
const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000,KEY=process.env.DASH_KEY||'',DATA=path.join(__dirname,'data'),FILE=path.join(DATA,'events.jsonl');
fs.mkdirSync(DATA,{recursive:true});
let cfg={};try{cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8'))}catch{}
const DEF={search:'/search|/availability|/rooms|/book',room:'/room|/suite|/rate',details:'/guest|/details|/checkout|/reserve',payment:'/pay',confirmed:'/confirm|/thank|/success'};
const IDX={search:1,room:2,details:3,payment:4,confirmed:5},NAMES=['Landing','Search','Room','Details','Payment','Confirmed'];
const stepOf=(site,p)=>{const s=Object.assign({},DEF,(cfg[site]||{}).steps);for(const k of ['confirmed','payment','details','room','search'])if(new RegExp(s[k],'i').test(p))return IDX[k];return 0};
const readAll=()=>fs.existsSync(FILE)?fs.readFileSync(FILE,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean):[];
function summary(site,days){
  const since=Date.now()-days*864e5,by={};
  readAll().forEach(e=>{if(e.site===site&&e.ts>=since)(by[e.sid]=by[e.sid]||[]).push(e)});
  const L=Object.values(by).map(es=>{const s={device:es[0].device,source:'Direct',load:null,reach:0,pages:0,t:new Set(),ferr:{}};
    es.forEach(e=>{s.t.add(e.t);if(e.t=='pageview'){s.pages++;s.reach=Math.max(s.reach,stepOf(site,e.path||'/'));if(s.pages==1)s.source=e.src||'Direct';if(s.load==null&&e.load)s.load=e.load}
      if(e.t=='form_error'){const f=(e.d&&e.d.field)||'unknown';s.ferr[f]=(s.ferr[f]||0)+1}if(e.t=='confirmed')s.reach=5});
    s.bounce=s.pages<=1&&!s.t.has('click');return s});
  const N=L.length;if(!N)return{N:0};
  const rate=l=>l.length?l.filter(s=>s.reach==5).length/l.length:0,br=l=>l.length?l.filter(s=>s.bounce).length/l.length:0,pc=x=>(x*100).toFixed(0)+'%';
  const fun=NAMES.map((_,k)=>L.filter(s=>s.reach>=k).length),exits=NAMES.map((_,k)=>L.filter(s=>s.reach==k&&k<5).length);
  const mob=L.filter(s=>s.device=='mobile'),dsk=L.filter(s=>s.device!='mobile'),timed=L.filter(s=>s.load!=null);
  const slow=timed.filter(s=>s.load>4),fast=timed.filter(s=>s.load<=4),I=[],avg=rate(L),warn=[];
  if(!fun[5])warn.push('No confirmed bookings seen. Check the "confirmed" URL pattern in config.json (or call hotelTrack("confirmed") on your thank-you page).');
  const ls=slow.length*(br(slow)-br(fast));
  if(slow.length>=5&&ls>0)I.push({n:ls,t:'Slow page load is driving visitors away',e:`${slow.length} visits loaded in over 4s: ${pc(br(slow))} bounced vs ${pc(br(fast))} on fast loads.`,f:'Compress images, lazy-load below the fold, use a CDN and trim third-party scripts. Prioritise mobile.'});
  const pay=L.filter(s=>s.reach==4);
  if(pay.length>=5)I.push({n:pay.length,t:'Guests abandon on the payment step',e:`${pay.length} sessions reached payment and left without a confirmation.`,f:'Show the full price earlier, add wallet payments (Apple/Google Pay) and reduce fields.'});
  const fe=L.filter(s=>Object.keys(s.ferr).length&&s.reach<5);
  if(fe.length){const c={};L.forEach(s=>Object.entries(s.ferr).forEach(([k,v])=>c[k]=(c[k]||0)+v));const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
    I.push({n:fe.length,t:'Booking forms are causing errors and abandonment',e:`${fe.length} guests hit validation errors and did not book. Most frequent field: "${top[0]}" (${top[1]}).`,f:'Validate inline, accept any phone format, make non-essential fields optional.'})}
  const pe=L.filter(s=>s.t.has('payment_error')&&s.reach<5);
  if(pe.length)I.push({n:pe.length,t:'Payments are failing',e:`${pe.length} guests got a payment error and did not complete.`,f:'Show clear errors, keep entered data, add retry and alternative payment methods.'});
  const ps=L.filter(s=>s.t.has('price_shock')&&s.reach<5);
  if(ps.length)I.push({n:ps.length,t:'Price jump at checkout',e:`${ps.length} guests saw a higher final price and left.`,f:'Show the all-inclusive total from the search results onward.'});
  const gap=rate(dsk)-rate(mob);
  if(mob.length>=10&&gap>.02)I.push({n:gap*mob.length,t:'Mobile experience underperforms desktop',e:`Mobile converts ${pc(rate(mob))} vs desktop ${pc(rate(dsk))}; mobile is ${pc(mob.length/N)} of traffic.`,f:'Sticky "Book" button, larger tap targets, autofill, fewer steps.'});
  const rg=L.filter(s=>s.t.has('rage_click')&&s.reach<5);
  if(rg.length)I.push({n:rg.length,t:'Guests rage-click on unresponsive elements',e:`${rg.length} lost sessions had rapid repeated clicks.`,f:'Check buttons, date pickers and filters for dead zones or slow responses.'});
  const src={};L.forEach(s=>(src[s.source]=src[s.source]||[]).push(s));
  Object.entries(src).forEach(([k,l])=>{if(l.length>=.15*N&&rate(l)<avg*.75)I.push({n:l.length*(avg-rate(l)),t:`${k} traffic converts poorly`,e:`${k} sends ${pc(l.length/N)} of visits but converts ${pc(rate(l))} vs ${pc(avg)} overall.`,f:'Match the ad promise to the landing page or shift budget to better channels.'})});
  I.sort((a,b)=>b.n-a.n);
  const c=cfg[site]||{};
  return{N,conv:avg,bounce:br(L),load:timed.length?timed.reduce((a,s)=>a+s.load,0)/timed.length:null,fun,exits,names:NAMES,issues:I,warn,value:(c.adr||0)*(c.nights||1)};
}
const mime={'.html':'text/html','.js':'application/javascript'};
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
  if(req.method=='OPTIONS'){res.writeHead(204,cors);return res.end()}
  if(u.pathname=='/collect'&&req.method=='POST'){let b='';req.on('data',c=>{b+=c;if(b.length>4096)req.destroy()});
    req.on('end',()=>{try{const e=JSON.parse(b);if(typeof e.site!='string'||typeof e.sid!='string'||typeof e.t!='string')throw 0;
      if(Object.keys(cfg).length&&!cfg[e.site]){res.writeHead(403,cors);return res.end()}
      e.ts=Date.now();fs.appendFileSync(FILE,JSON.stringify(e)+'\n');res.writeHead(204,cors);res.end()}catch{res.writeHead(400,cors);res.end()}});return}
  if(u.pathname=='/tracker.js'){res.writeHead(200,{'Content-Type':'application/javascript',...cors});return res.end(fs.readFileSync(path.join(__dirname,'public/tracker.js')))}
  if(KEY&&u.searchParams.get('key')!==KEY){res.writeHead(401);return res.end('Unauthorized: add ?key=YOUR_DASH_KEY')}
  if(u.pathname=='/api/sites'){const s=new Set(Object.keys(cfg));readAll().forEach(e=>s.add(e.site));res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify([...s]))}
  if(u.pathname=='/api/summary'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(summary(u.searchParams.get('site')||'',+u.searchParams.get('days')||30)))}
  if(u.pathname=='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(fs.readFileSync(path.join(__dirname,'public/dashboard.html')))}
  res.writeHead(404);res.end();
}).listen(PORT,()=>console.log('Hotel tracker on http://localhost:'+PORT));
