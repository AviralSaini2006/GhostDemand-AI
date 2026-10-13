// Hotel tracker: collector + analysis + public-site audit + dashboard. Node >= 18, no dependencies.
const http=require('http'),fs=require('fs'),path=require('path'),dns=require('dns').promises;
const PORT=process.env.PORT||3000,KEY=process.env.DASH_KEY||'',DATA=path.join(__dirname,'data'),FILE=path.join(DATA,'events.jsonl'),CFG=path.join(__dirname,'config.json');
fs.mkdirSync(DATA,{recursive:true});
let cfg={};try{cfg=JSON.parse(fs.readFileSync(CFG,'utf8'))}catch{}
const norm=s=>String(s||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split('?')[0];
const DEF={search:'/search|/availab|/rooms|/accommodation|/book',room:'/room/|/suite|/rate/',details:'/guest|/details|/checkout|/reserve|/traveler',payment:'/pay|/billing',confirmed:'/confirm|/thank|/success|/receipt'};
const IDX={search:1,room:2,details:3,payment:4,confirmed:5},NAMES=['Landing','Search','Room','Details','Payment','Confirmed'];
const stepOf=(site,p)=>{const s=Object.assign({},DEF,(cfg[site]||{}).steps);for(const k of ['confirmed','payment','details','room','search']){try{if(new RegExp(s[k],'i').test(p))return IDX[k]}catch{}}return 0};
const readAll=()=>fs.existsSync(FILE)?fs.readFileSync(FILE,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean):[];
const BOT=/bot|crawl|spider|headless|lighthouse|pagespeed|preview|monitor|curl|python-requests/i;

function sessions(site,days){const since=Date.now()-days*864e5,by={};
  readAll().forEach(e=>{if(e.site===site&&e.ts>=since)(by[e.sid]=by[e.sid]||[]).push(e)});
  return Object.values(by).map(es=>{const s={device:es[0].device,source:'direct',load:null,reach:0,pages:0,t:new Set(),ferr:{},first:es[0].ts,last:es[0].ts,lastPath:'/'};
    es.forEach(e=>{s.t.add(e.t);s.last=Math.max(s.last,e.ts);if(e.t=='pageview'){s.pages++;s.lastPath=e.path||'/';s.reach=Math.max(s.reach,stepOf(site,e.path||'/'));if(s.pages==1)s.source=e.src||'direct';if(s.load==null&&e.load)s.load=e.load}
      if(e.t=='form_error'){const f=(e.d&&e.d.field)||'unknown';s.ferr[f]=(s.ferr[f]||0)+1}if(e.t=='confirmed')s.reach=5});
    s.bounce=s.pages<=1&&!s.t.has('click');return s})}
function summary(site,days){
  const L=sessions(site,days),N=L.length;if(!N)return{N:0};
  const rate=l=>l.length?l.filter(s=>s.reach==5).length/l.length:0,br=l=>l.length?l.filter(s=>s.bounce).length/l.length:0,pc=x=>(x*100).toFixed(0)+'%';
  const fun=NAMES.map((_,k)=>L.filter(s=>s.reach>=k).length),exits=NAMES.map((_,k)=>L.filter(s=>s.reach==k&&k<5).length);
  const mob=L.filter(s=>s.device=='mobile'),dsk=L.filter(s=>s.device!='mobile'),timed=L.filter(s=>s.load!=null);
  const slow=timed.filter(s=>s.load>4),fast=timed.filter(s=>s.load<=4),I=[],avg=rate(L),warn=[];
  if(!fun[5])warn.push('No confirmed bookings seen. Adjust the URL step patterns for this site (Add site form), or call hotelTrack("confirmed") on the thank-you page. Booking engines on another domain need the snippet too.');
  if(N<30)warn.push('Only '+N+' sessions so far. Findings get reliable after a few hundred.');
  const ls=slow.length*(br(slow)-br(fast));
  if(slow.length>=5&&ls>0)I.push({n:ls,t:'Slow page load is driving visitors away',e:`${slow.length} visits loaded in over 4s: ${pc(br(slow))} bounced vs ${pc(br(fast))} on fast loads.`,f:'Compress images, lazy-load below the fold, use a CDN, trim third-party scripts. Prioritise mobile.'});
  const pay=L.filter(s=>s.reach==4);
  if(pay.length>=5)I.push({n:pay.length,t:'Guests abandon on the payment step',e:`${pay.length} sessions reached payment and left without a confirmation.`,f:'Show the full price earlier, add wallet payments, reduce fields.'});
  const fe=L.filter(s=>Object.keys(s.ferr).length&&s.reach<5);
  if(fe.length){const c={};L.forEach(s=>Object.entries(s.ferr).forEach(([k,v])=>c[k]=(c[k]||0)+v));const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
    I.push({n:fe.length,t:'Booking forms are causing errors and abandonment',e:`${fe.length} guests hit validation errors and did not book. Most frequent field: "${top[0]}" (${top[1]}).`,f:'Validate inline, accept any phone format, make non-essential fields optional.'})}
  const pe=L.filter(s=>s.t.has('payment_error')&&s.reach<5);
  if(pe.length)I.push({n:pe.length,t:'Payments are failing',e:`${pe.length} guests got a payment error and did not complete.`,f:'Clear errors, keep entered data, add retry and alternative payment methods.'});
  const ps=L.filter(s=>s.t.has('price_shock')&&s.reach<5);
  if(ps.length)I.push({n:ps.length,t:'Price jump at checkout',e:`${ps.length} guests saw a higher final price and left.`,f:'Show the all-inclusive total from search results onward.'});
  const gap=rate(dsk)-rate(mob);
  if(mob.length>=10&&gap>.02)I.push({n:gap*mob.length,t:'Mobile experience underperforms desktop',e:`Mobile converts ${pc(rate(mob))} vs desktop ${pc(rate(dsk))}; mobile is ${pc(mob.length/N)} of traffic.`,f:'Sticky "Book" button, larger tap targets, autofill, fewer steps.'});
  const rg=L.filter(s=>s.t.has('rage_click')&&s.reach<5);
  if(rg.length)I.push({n:rg.length,t:'Guests rage-click on unresponsive elements',e:`${rg.length} lost sessions had rapid repeated clicks.`,f:'Check buttons, date pickers and filters for dead zones or slow responses.'});
  const src={};L.forEach(s=>(src[s.source]=src[s.source]||[]).push(s));
  Object.entries(src).forEach(([k,l])=>{if(l.length>=.15*N&&rate(l)<avg*.75)I.push({n:l.length*(avg-rate(l)),t:`${k} traffic converts poorly`,e:`${k} sends ${pc(l.length/N)} of visits but converts ${pc(rate(l))} vs ${pc(avg)} overall.`,f:'Match the ad promise to the landing page or shift budget to better channels.'})});
  I.sort((a,b)=>b.n-a.n);
  const daily={},ex={};L.forEach(s=>{const d=new Date(s.first).toISOString().slice(5,10);(daily[d]=daily[d]||{s:0,b:0}).s++;if(s.reach==5)daily[d].b++;if(s.reach<5)ex[s.lastPath]=(ex[s.lastPath]||0)+1});
  const c=cfg[site]||{};
  return{N,conv:avg,bounce:br(L),load:timed.length?timed.reduce((a,s)=>a+s.load,0)/timed.length:null,fun,exits,names:NAMES,issues:I,warn,value:(c.adr||0)*(c.nights||1),
    daily:Object.entries(daily).sort(),exitPages:Object.entries(ex).sort((a,b)=>b[1]-a[1]).slice(0,6),live:L.filter(s=>s.last>Date.now()-3e5).length,
    sources:Object.entries(src).map(([k,l])=>[k,l.length,rate(l)]).sort((a,b)=>b[1]-a[1]),devices:{mobile:[mob.length,rate(mob)],desktop:[dsk.length,rate(dsk)]}}}

// ---------- public-site audit (no install needed) ----------
const UA='Mozilla/5.0 (compatible; HotelAudit/1.0)';
const priv=ip=>/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|f[cd]|fe80)/i.test(ip);
async function safeUrl(raw){const u=new URL(/^https?:/i.test(raw)?raw:'https://'+raw);if(!/^https?:$/.test(u.protocol))throw new Error('Only http(s) URLs');
  if(!process.env.ALLOW_PRIVATE){const a=await dns.lookup(u.hostname,{all:true});if(a.some(x=>priv(x.address)))throw new Error('Private addresses are blocked')}return u.href}
async function fetchSafe(raw){let u=raw,hops=0;const t0=Date.now();
  for(;;){const url=await safeUrl(u),r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':UA,'Accept-Language':'en'}});
    if(r.status>=300&&r.status<400&&r.headers.get('location')&&hops++<4){u=new URL(r.headers.get('location'),url).href;continue}
    const ttfb=Date.now()-t0,buf=Buffer.from(await r.arrayBuffer()).subarray(0,2e6);return{r,url,html:buf.toString('utf8'),ttfb,bytes:buf.length}}}
async function psi(u){try{const r=await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=performance&url='+encodeURIComponent(u)+(process.env.PSI_KEY?'&key='+process.env.PSI_KEY:''),{signal:AbortSignal.timeout(60000)});
  if(!r.ok)return{error:'PageSpeed API returned '+r.status+' (set PSI_KEY for higher limits)'};const j=await r.json(),a=j.lighthouseResult.audits,f=(j.loadingExperience||{}).metrics||{};
  return{score:Math.round(j.lighthouseResult.categories.performance.score*100),lcp:a['largest-contentful-paint'].displayValue,cls:a['cumulative-layout-shift'].displayValue,tbt:a['total-blocking-time'].displayValue,lcpSec:a['largest-contentful-paint'].numericValue/1000,
    fieldLcp:f.LARGEST_CONTENTFUL_PAINT_MS?+(f.LARGEST_CONTENTFUL_PAINT_MS.percentile/1000).toFixed(1):null,fieldCat:(j.loadingExperience||{}).overall_category||null}}catch(e){return{error:'PageSpeed unavailable ('+e.message+')'}}}
async function audit(raw){
  const {r,url,html,ttfb,bytes}=await fetchSafe(raw),host=new URL(url).hostname,F=[],add=(sev,t,e,f)=>F.push({sev,t,e,f});
  const m=(re,i=1)=>{const x=html.match(re);return x?x[i]:null},tags=re=>html.match(re)||[];
  const scripts=tags(/<script[^>]+src=["'][^"']+/gi).map(x=>x.split(/["']/).pop()),third=[...new Set(scripts.map(s=>{try{return new URL(s,url).hostname}catch{return null}}).filter(h=>h&&!h.endsWith(host.replace(/^www\./,''))))];
  const imgs=tags(/<img\b[^>]*>/gi),noAlt=imgs.filter(i=>!/\balt=/i.test(i)).length,eager=imgs.slice(3).filter(i=>!/loading=["']lazy/i.test(i)).length;
  const title=m(/<title[^>]*>([^<]*)/i),desc=m(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i),viewport=/<meta[^>]+name=["']viewport/i.test(html);
  const cta=/book now|check availability|reserve|book a (room|stay)|book your stay|check rates/i.test(html),price=/[$€£₹]\s?\d|\b(INR|USD|EUR|GBP)\b/.test(html),fees=/taxes|resort fee|service charge|plus applicable|inclusive of/i.test(html);
  const engine=(m(/(synxis|travelclick|cloudbeds|siteminder|webrezpro|bookassist|ihgplc|bookingengine|reservations\.[a-z0-9-]+\.[a-z]+|booking\.[a-z0-9-]+\.[a-z]+)/i)||'').toLowerCase(),
    tools=['googletagmanager','google-analytics','gtag','fbq','hotjar','clarity.ms','tracker.js'].filter(k=>html.includes(k));
  if(!/^https:/.test(url))add('high','Site is not served over HTTPS','Browsers warn guests and payment trust drops.','Install a TLS certificate and redirect all http traffic to https.');
  if(r.status>=400)add('high','Page returned HTTP '+r.status,'Guests landing here see an error.','Fix the page or redirect it.');
  if(ttfb>1500)add(ttfb>3000?'high':'med','Slow server response ('+ttfb+' ms)','Slow first byte delays everything after it.','Add caching/CDN, optimise the backend, or upgrade hosting.');
  if(bytes>1e6)add('med','Very large HTML ('+Math.round(bytes/1024)+' KB)','Heavy HTML slows mobile guests.','Reduce inline data and unused markup.');
  if(!/gzip|br|deflate|zstd/i.test(r.headers.get('content-encoding')||''))add('low','No compression header','Pages download larger than needed.','Enable gzip or Brotli on the server.');
  if(!viewport)add('high','No mobile viewport tag','Page may render as a tiny desktop layout on phones.','Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  if(third.length>8)add('med',third.length+' third-party script domains','Each external script slows load and can break the booking flow.','Remove unused tags; load the rest async or via a tag manager.');
  if(eager>6)add('med',eager+' images are not lazy-loaded','Guests wait for off-screen photos.','Add loading="lazy" to below-the-fold images and serve WebP/AVIF.');
  if(imgs.length&&noAlt>imgs.length*.3)add('low',noAlt+' of '+imgs.length+' images lack alt text','Hurts accessibility and SEO.','Add descriptive alt text.');
  if(!title||title.length<15)add('low','Weak or missing page title','Lowers search click-through.','Write a descriptive title with the hotel name and city.');
  if(!desc)add('low','No meta description','Search engines pick random text.','Add a 140-160 character description with a booking hook.');
  if(!cta)add('high','No clear booking call-to-action found in the HTML','Guests may not know where to book. (JS-rendered buttons can be missed.)','Put a visible "Check availability" or "Book now" button above the fold, sticky on mobile.');
  if(price&&!fees)add('med','Prices shown without any tax or fee wording','Surprise fees at checkout are a top reason for abandonment.','State what is included or add "taxes and fees included/extra" next to prices.');
  if(!/"@type"\s*:\s*"(Hotel|LodgingBusiness|Resort)"/i.test(html))add('low','No Hotel structured data','Misses rich results in Google.','Add schema.org Hotel JSON-LD.');
  if(!tools.length)add('med','No analytics or tracking detected','The hotel cannot see why guests leave.','Install analytics, or the tracking snippet from the Visitors tab.');
  const g=await psi(url);
  if(g.score!=null){if(g.score<50)add('high','Mobile performance score '+g.score+'/100','Google Lighthouse rates mobile speed as poor (LCP '+g.lcp+', TBT '+g.tbt+').','Optimise images, defer scripts, reduce JavaScript.');else if(g.score<75)add('med','Mobile performance score '+g.score+'/100','Mobile speed needs work (LCP '+g.lcp+').','Optimise largest image, defer non-critical scripts.');
    if(g.fieldCat&&g.fieldCat!='FAST')add('high','Real-user speed is rated '+g.fieldCat,'Google Chrome field data (real visitors) shows slow loading, LCP '+g.fieldLcp+'s.','Treat speed as the top conversion fix.')}
  const w={high:3,med:2,low:1};F.sort((a,b)=>w[b.sev]-w[a.sev]);
  return{url,status:r.status,ttfb,kb:Math.round(bytes/1024),scripts:scripts.length,thirdParty:third.length,images:imgs.length,engine:engine||null,tools,psi:g,findings:F,score:Math.max(0,100-F.reduce((a,x)=>a+w[x.sev]*5,0)),
    note:'Based on the public HTML and Google PageSpeed. Pages that build content with JavaScript may be under-reported. This is not visitor data.'}}

const J=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
  if(req.method=='OPTIONS'){res.writeHead(204,cors);return res.end()}
  if(u.pathname=='/collect'&&req.method=='POST'){let b='';req.on('data',c=>{b+=c;if(b.length>4096)req.destroy()});
    req.on('end',()=>{try{const e=JSON.parse(b);if(typeof e.site!='string'||typeof e.sid!='string'||typeof e.t!='string')throw 0;e.site=norm(e.site);
      if(BOT.test(req.headers['user-agent']||'')){res.writeHead(204,cors);return res.end()}
      if(Object.keys(cfg).length&&!cfg[e.site]){res.writeHead(403,cors);return res.end()}
      const o=req.headers.origin;if(o&&o!=='null'){const h=norm(o);if(h!==e.site&&!h.endsWith('.'+e.site)){res.writeHead(403,cors);return res.end()}}
      e.ts=Date.now();fs.appendFileSync(FILE,JSON.stringify(e)+'\n');res.writeHead(204,cors);res.end()}catch{res.writeHead(400,cors);res.end()}});return}
  if(u.pathname=='/tracker.js'){res.writeHead(200,{'Content-Type':'application/javascript',...cors});return res.end(fs.readFileSync(path.join(__dirname,'public/tracker.js')))}
  if(KEY&&u.searchParams.get('key')!==KEY){res.writeHead(401);return res.end('Unauthorized: add ?key=YOUR_DASH_KEY')}
  try{
  if(u.pathname=='/api/sites'){const s=new Set(Object.keys(cfg));readAll().forEach(e=>s.add(e.site));return J(res,200,[...s])}
  if(u.pathname=='/api/summary')return J(res,200,summary(norm(u.searchParams.get('site')),+u.searchParams.get('days')||30));
  if(u.pathname=='/api/audit')return J(res,200,await audit(u.searchParams.get('url')||''));
  if(u.pathname=='/api/export'){const L=sessions(norm(u.searchParams.get('site')),+u.searchParams.get('days')||30);res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename=sessions.csv'});
    return res.end('device,source,load_s,furthest_step,pages,form_errors\n'+L.map(s=>[s.device,s.source,s.load??'',NAMES[s.reach],s.pages,Object.values(s.ferr).reduce((a,b)=>a+b,0)].join(',')).join('\n'))}
  if(u.pathname=='/api/site'&&req.method=='POST'){const ip=req.socket.remoteAddress||'';if(!KEY&&!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip))return J(res,403,{error:'Set DASH_KEY to edit sites remotely'});
    let b='';for await(const c of req)b+=c;const j=JSON.parse(b||'{}'),s=norm(j.site);if(!s.includes('.'))return J(res,400,{error:'Enter a domain like yourhotel.com'});
    cfg[s]=Object.assign(cfg[s]||{},{adr:+j.adr||0,nights:+j.nights||1},j.steps?{steps:j.steps}:{});fs.writeFileSync(CFG,JSON.stringify(cfg,null,2));return J(res,200,{ok:true,site:s})}
  if(u.pathname=='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(fs.readFileSync(path.join(__dirname,'public/dashboard.html')))}
  }catch(e){return J(res,500,{error:e.message})}
  res.writeHead(404);res.end();
}).listen(PORT,()=>console.log('Hotel tracker on http://localhost:'+PORT+(KEY?'':'  (no DASH_KEY set: dashboard is open to anyone who can reach it)')));
