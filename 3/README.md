# Hotel Tracker
1. **Audit any website** (no install): paste a public hotel URL. Fetches the page and calls Google PageSpeed (mobile). Optional env `PSI_KEY` for higher API limits.
2. **Visitor analytics** (real tracking): paste the snippet on a site you control. Works as a plain script or a Google Tag Manager Custom HTML tag.

## Run
    node server.js                          # Node 18+, no npm install
    DASH_KEY=secret node server.js          # protect dashboard: /?key=secret   (PowerShell: $env:DASH_KEY="secret"; node server.js)
Deploy on a public HTTPS host for real sites. Register a domain from the dashboard ("Register or edit a site") or in config.json.

## Notes
- Source labels: gclid/gbraid -> google-ads, fbclid -> facebook-ads, msclkid -> bing-ads, utm_source, else referrer.
- Bots, headless browsers and mismatched Origin headers are dropped. Audit blocks private/internal addresses.
- Booking engines on another domain: install the snippet there too (sessions are per-domain, so a guest crossing domains appears as two sessions).
- Custom events: hotelTrack('payment_error'), hotelTrack('price_shock',{listed:360,final:439}), hotelTrack('confirmed').
- Privacy: no cookies, form values or IPs stored. You remain responsible for consent notices.
