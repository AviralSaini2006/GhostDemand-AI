# Hotel Tracker
Tracks real visitor activity on a hotel website and explains why guests leave.

## Run
    node server.js            # Node 18+, no npm install needed
    DASH_KEY=secret node server.js   # protect the dashboard (open /?key=secret)

## Connect a hotel site
1. Add the domain to `config.json` (adr/nights optional, used for revenue estimates; `steps` are URL regexes for the booking funnel).
2. Open the dashboard, enter the domain, copy the snippet, paste it before `</body>` on every page.
3. Server must be reachable over HTTPS from the internet (deploy it, or use a tunnel such as cloudflared/ngrok for testing).
4. Optional custom events from the hotel's code: `hotelTrack('payment_error')`, `hotelTrack('price_shock',{listed:360,final:439})`, `hotelTrack('confirmed')`.

## Privacy
No cookies, no form values, no IPs stored. Random per-tab session id. You are still responsible for consent/notice under GDPR, CCPA, etc.
