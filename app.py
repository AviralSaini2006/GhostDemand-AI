"""GhostDemand AI: minimal backend. One file, SQLite, two small models.

Run:  pip install -r requirements.txt
      uvicorn app:app --reload
Open: http://127.0.0.1:8000  (demo page)   http://127.0.0.1:8000/docs  (API)

The models train at startup on SYNTHETIC guests. To go real, replace make_training_data()
with a query over your logged sessions, the offers shown, and whether each guest booked.
"""
import sqlite3
import time
from functools import lru_cache
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import BernoulliNB

BASE, FLEX_COST = 8500, 300
PERSONAS = ["price", "policy", "competitor", "friction"]
PRIORS = [0.44, 0.26, 0.18, 0.12]
# chance each persona shows each signal: [rate viewed twice, read policy, payment error, other tab]
RATES = np.array([[.8, .15, .05, .15], [.3, .9, .05, .1], [.5, .15, .05, .85], [.25, .15, .7, .1]])
B0 = np.array([.042, .05, .04, .03])        # booking chance with no offer
L_DISC = np.array([1.1, .25, .6, .15])      # response to discounts
L_FLEX = np.array([0.0, 1.2, .1, .1])       # response to free flexible cancellation
OFFERS = [("Hold the rate", 0, 0), ("₹500 off", 500, 0), ("₹1,000 off", 1000, 0),
          ("Free flexible cancellation", 0, 1)]
EVENTS = Literal["search", "rate", "policy", "other_tab", "error", "checkout", "leave", "book"]


def p_true(persona, d, f):
    """Hidden ground truth, used only to simulate guests."""
    b = B0[persona]
    z = np.log(b / (1 - b)) + L_DISC[persona] * (1 - np.exp(-d / 700)) + L_FLEX[persona] * f
    return 1 / (1 + np.exp(-z))


def features(s, d, f):
    D = 1 - np.exp(-np.asarray(d) / 700)
    f = np.asarray(f, dtype=float)
    return np.column_stack([s, D, s * D[:, None], f, s * f[:, None]])


def draw(rng, n):
    persona = rng.choice(4, n, p=PRIORS)
    return persona, (rng.random((n, 4)) < RATES[persona]).astype(int)


def make_training_data(n=30000):
    rng = np.random.default_rng(7)
    persona, s = draw(rng, n)
    o = rng.integers(0, 4, n)                       # offers were randomized in the past
    d = np.array([OFFERS[i][1] for i in o])
    f = np.array([OFFERS[i][2] for i in o])
    booked = rng.random(n) < p_true(persona, d, f)
    return persona, s, d, f, booked


persona, S, D, F, Y = make_training_data()
offer_model = LogisticRegression(C=10, max_iter=1000).fit(features(S, D, F), Y)
reason_model = BernoulliNB().fit(S, [PERSONAS[i] for i in persona])

# ---------- storage ----------
DB = "ghostdemand.db"


def db():
    c = sqlite3.connect(DB)
    c.execute("CREATE TABLE IF NOT EXISTS events(session_id TEXT, ts REAL, type TEXT, nights INT)")
    return c


# ---------- decision ----------
@lru_cache(maxsize=None)
def decide(sig, nights, var_cost, max_disc):
    rows = []
    for label, d, f in OFFERS:
        if d > max_disc:
            continue
        p = float(offer_model.predict_proba(features(np.array([sig]), [d], [f]))[0, 1])
        margin = BASE - d - var_cost - f * FLEX_COST
        rows.append(dict(offer=label, discount=d, flex=f, p_book=round(p, 4),
                         profit_if_booked=margin * nights,
                         expected_profit=round(margin * nights * p, 2)))
    base = rows[0]
    best = max(rows, key=lambda r: r["expected_profit"])
    if best["expected_profit"] - base["expected_profit"] < 15:   # only act if it clearly helps
        best = base
    return rows, best


def reasons(sig):
    p = reason_model.predict_proba([list(sig)])[0]
    return sorted(({"reason": c, "probability": round(float(v), 3)}
                   for c, v in zip(reason_model.classes_, p)), key=lambda r: -r["probability"])


# ---------- API ----------
app = FastAPI(title="GhostDemand AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])  # demo only


class Event(BaseModel):
    session_id: str
    type: EVENTS
    nights: int = 2
    consent: bool = False


@app.post("/events")
def add_event(e: Event):
    if not e.consent:                                # no consent, nothing is stored
        return {"stored": False}
    with db() as c:
        c.execute("INSERT INTO events VALUES (?,?,?,?)", (e.session_id, time.time(), e.type, e.nights))
    return {"stored": True}


@app.get("/score/{session_id}")
def score(session_id: str, var_cost: int = 3000, max_discount: int = 1000):
    with db() as c:
        rows = c.execute("SELECT type, nights FROM events WHERE session_id=? ORDER BY ts", (session_id,)).fetchall()
    if not rows:
        raise HTTPException(404, "No consented events for this session")
    types = [r[0] for r in rows]
    sig = (int(types.count("rate") >= 2), int("policy" in types), int("error" in types), int("other_tab" in types))
    offers, best = decide(sig, rows[-1][1], var_cost, max_discount)
    return {"signals": dict(zip(["rate_twice", "policy", "error", "other_tab"], sig)),
            "reasons": reasons(sig), "offers": offers, "recommended": best,
            "show_popup": best["discount"] > 0 or best["flex"] > 0}


@app.get("/simulate")
def simulate(n: int = Query(20000, ge=100, le=200000), var_cost: int = 3000, max_discount: int = 1000):
    """Holdout test on synthetic guests: no offer vs blanket ₹1,000 vs GhostDemand."""
    rng = np.random.default_rng(2026)
    pers, sig = draw(rng, n)
    nights, arm = rng.integers(1, 4, n), rng.integers(0, 3, n)
    d, f = np.zeros(n), np.zeros(n)
    for i in range(n):
        if arm[i] == 1:
            d[i] = 1000
        elif arm[i] == 2:
            b = decide(tuple(int(x) for x in sig[i]), int(nights[i]), var_cost, max_discount)[1]
            d[i], f[i] = b["discount"], b["flex"]
    booked = rng.random(n) < p_true(pers, d, f)
    profit = booked * nights * (BASE - d - var_cost - f * FLEX_COST)
    names = ["no_offer", "blanket_1000", "ghostdemand"]
    out = {nm: {"guests": int((arm == k).sum()), "bookings": int(booked[arm == k].sum()),
                "profit_per_guest": round(float(profit[arm == k].mean()), 2)} for k, nm in enumerate(names)}
    for nm in names[1:]:
        out[nm]["incremental_profit_total"] = round((out[nm]["profit_per_guest"] - out["no_offer"]["profit_per_guest"]) * n)
    return out


DEMO = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>GhostDemand demo</title><body style="font:16px system-ui;max-width:640px;margin:24px auto;padding:0 16px">
<h2>Hotel Aurelia · Deluxe King · ₹8,500</h2>
<label><input type=checkbox id=c checked> Allow analytics</label><br><br>
<button onclick="ev('rate')">Look at rate again</button> <button onclick="ev('policy')">Read cancellation policy</button>
<button onclick="ev('other_tab')">Open another travel site</button> <button onclick="ev('error')">Payment error</button><br><br>
<button onclick="leave()"><b>Leave site</b></button>
<pre id=o style="white-space:pre-wrap;margin-top:16px"></pre>
<script>
const sid=crypto.randomUUID();
const ev=t=>fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({session_id:sid,type:t,nights:2,consent:c.checked})});
ev('search');ev('rate');
async function leave(){await ev('leave');
 const r=await fetch('/score/'+sid);if(!r.ok){o.textContent='No consent, nothing tracked, no offer.';return}
 const j=await r.json();
 o.textContent='Likely reason: '+j.reasons[0].reason+' ('+Math.round(j.reasons[0].probability*100)+'%)\\n\\n'+
 j.offers.map(x=>x.offer+': P(book) '+(x.p_book*100).toFixed(1)+'%, expected profit ₹'+Math.round(x.expected_profit)).join('\\n')+
 '\\n\\n'+(j.show_popup?'POPUP: '+j.recommended.offer:'No popup: keep the rate.')}
</script>"""


@app.get("/", response_class=HTMLResponse)
def home():
    return DEMO


@app.get("/hotel", response_class=HTMLResponse)
def hotel():
    return (Path(__file__).parent / "hotel.html").read_text(encoding="utf-8")
