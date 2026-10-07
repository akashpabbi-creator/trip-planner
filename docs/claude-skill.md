---
name: trip-planner
description: Work on Akash and Sanj's shared trip plan from the Claude app. Reads the live plan through the "Claude link", then sends back proposals (a day-by-day plan, change requests, top picks, vegetarian checks, places from links and screenshots, a plan review, bookings from Gmail, packing lists). The couple review everything in their trip planner app before anything changes. Use whenever the user mentions their trip planner, trip plan, a Claude link, or pastes a message with a project, apiKey and token.
---

# Trip planner (Claude link)

The couple plan trips together in a small web app (the "trip planner"). It has a **Claude link**: a private document that holds a copy of the current plan and an inbox. You read the plan from it and put proposals in the inbox. The app turns each proposal into something the couple review and accept, whole or one item at a time. You never edit the plan directly, and you don't need to sign in to anything.

Everything here is free: no paid APIs, only plain HTTPS calls to Firestore with the details the user pasted.

## 1. What you need from the user

The user taps **Connect Claude** in the app and pastes you a message like this:

```
Please use your "trip-planner" skill to help with my trip "Italy" (Rome) ...
project: our-trips-ab49a
apiKey: AIza...
token: Qx3...   (32 characters)
app: https://example.github.io/trip-planner/
```

Those three values (`project`, `apiKey`, `token`) are all you need. They are not secret credentials in the usual sense (the apiKey is a public web key), but the **token is the key to this one trip: don't share it or print it more than you must**. Optional line `host:` is only for testing against an emulator.

If the message is missing, ask the user to open the trip in the app, tap **More, then Connect Claude, then Copy for Claude**, and paste it to you.

## 2. What you can do for them

| They ask for | You send | Notes |
|---|---|---|
| "Plan my days" / "build the itinerary" | `plan` | Only when they ask. Fills days. |
| "Make Day 2 slower", "swap X and Y", "move dinner later", "add a rest stop" | `changes` | Small, reviewed edits. |
| "Find the best places to eat/see" | `picks` | Shows on the Discover tab. |
| "Check these restaurants for vegetarian food" | `changes` with `veg` ops (and `note` ops) | Check menus and reviews with your web search. |
| "Here's an Instagram link / blog / screenshot" | `changes` with `add` ops | Read it, list the real places. They go to Ideas unless the user says a day. |
| "Review our plan" | `review` | Pacing, timing, opening hours, travel, balance, budget. |
| "Add my bookings" (flights, hotels, trains, tickets) | `changes` with `booking` ops | Search their Gmail for confirmations, never guess details. |
| "What should we pack?" | `changes` with `check` ops (`group: "pack"`) | Based on weather, plan, destination. Use `todo` for things to book or arrange. |

Anything else the app can hold (a note on a stop, a day title, a stay base, how to get between stops, a fixed time) is also a `changes` op.

## 3. Rules (never break these)

1. **Proposals only.** Everything you send is a suggestion. Say so. Never claim you changed their plan; tell them to open the trip planner and review.
2. **Vegetarian rule.** They are vegetarian. Every restaurant must serve good vegetarian dishes. It does **not** have to be a pure vegetarian restaurant; meat on the menu is fine if there are several proper vegetarian dishes. Check menus and reviews (web search) and set `veg` and a short `vegNote` ("order the cacio e pepe, ricotta ravioli"). Watch for hidden fish sauce, dashi, shrimp paste, lard, gelatin and meat stock. If a place has little or nothing vegetarian, leave it out (the app refuses it anyway). Eggs are fine.
3. **Days fill only on demand.** Send a `plan` only when they ask you to plan or fill days. In `changes`, don't add stops to empty days unless the request says so; put new finds in Ideas (`"toDay": null`).
4. **Keep what the couple chose.** Don't remove or move places they saved or marked must-do (`mustDo: true`) unless they ask. Prefer the smallest change that does what they asked (at most 12 ops).
5. **Use real, named places** with a street or area you can give an address for. Don't invent places, times, prices or booking references. If unsure, leave the field empty or ask the user.
6. **Use only `itemId`s that appear in the snapshot**, and days numbered from 1 (Day 1 = `toDay: 1`).
7. Plain words in every `why`, `summary` and `note`. One short sentence each.
8. Never put the Gemini key or anyone's email into a payload. (The snapshot doesn't contain them either.)

## 4. The script

Save this as `trip_planner.py` (standard library only, Python 3.8+). It reads the plan, checks a payload against the rules above and sends it.

```python
#!/usr/bin/env python3
"""trip_planner.py: read the plan from the Claude link and send proposals. Standard library only.

  python3 trip_planner.py read [--out plan.json]      print the plan snapshot (JSON)
  python3 trip_planner.py check payload.json          check a payload, send nothing
  python3 trip_planner.py send payload.json           check, then send to the app (use - for stdin)
  python3 trip_planner.py paste payload.json          check, then print one line to paste into the app by hand

Settings come from flags or env: TRIP_PROJECT, TRIP_API_KEY, TRIP_TOKEN (and TRIP_HOST for an emulator).
"""
import argparse, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

KINDS = ("plan", "changes", "picks", "review")
OPS = ("move", "remove", "add", "time", "transport", "day", "veg", "note", "booking", "check")
MODES = ("walk", "transit", "bus", "train", "car", "rental", "taxi", "bike", "ferry", "flight")
BOOKINGS = ("flight", "hotel", "train", "bus", "ferry", "car", "tickets", "other")
CATS = ("sight", "activity", "food", "stay", "shopping", "nature", "transport", "other")
MAX_JSON = 700_000  # a Firestore doc is capped at 1 MB


def settings(a):
    host = (a.host or os.environ.get("TRIP_HOST") or "https://firestore.googleapis.com").rstrip("/")
    s = dict(project=a.project or os.environ.get("TRIP_PROJECT"), key=a.api_key or os.environ.get("TRIP_API_KEY", ""),
             token=a.token or os.environ.get("TRIP_TOKEN"), host=host)
    missing = [k for k in ("project", "token") if not s[k]]
    if missing:
        sys.exit("Missing " + ", ".join(missing) + ". Pass --project/--token (and --api-key) or set TRIP_PROJECT / TRIP_TOKEN / TRIP_API_KEY.")
    return s


def base(s):
    return f"{s['host']}/v1/projects/{s['project']}/databases/(default)/documents"


def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        hint = {403: "The link may be turned off, or the Firestore rules for the Claude link aren't published yet.",
                404: "No such link. Check the token, or ask the user to reconnect Claude in the app."}.get(e.code, "")
        sys.exit(f"HTTP {e.code} from Firestore. {hint}\n{e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"No network ({e.reason}). Use the paste fallback: python3 trip_planner.py paste payload.json")


def q(s):
    return "?key=" + urllib.parse.quote(s["key"]) if s["key"] else ""


def read_snapshot(s):
    d = call("GET", f"{base(s)}/bridges/{s['token']}{q(s)}")
    raw = d.get("fields", {}).get("snapshot", {}).get("stringValue", "")
    if not raw:
        sys.exit("The plan isn't ready yet. Ask the user to open the trip in the app for a few seconds, then try again.")
    return json.loads(raw)


def known(snap):
    ids = {i["id"] for day in snap.get("days", []) for i in day.get("schedule", [])}
    ids |= {i["id"] for i in snap.get("ideasNotScheduled", [])}
    return ids, len(snap.get("days", []))


def check(p, snap=None):
    """Returns (errors, warnings). Errors would be refused or are wrong; warnings are worth a second look."""
    err, warn = [], []
    if not isinstance(p, dict) or p.get("kind") not in KINDS:
        return [f'"kind" must be one of {KINDS}'], warn
    if len(json.dumps(p)) > MAX_JSON:
        err.append("Too big (over 700 KB): split it into several sends.")
    ids, ndays = known(snap) if snap else (None, None)
    k = p["kind"]
    if k == "plan":
        d = p.get("draft") or {}
        if not isinstance(d.get("days"), list) or not d["days"]:
            err.append("plan needs draft.days (a list, one entry per trip day)")
        if ndays and len(d.get("days", [])) != ndays:
            warn.append(f"The trip has {ndays} days, the plan has {len(d.get('days', []))}.")
        for day in d.get("days", []):
            foods = [i for i in day.get("items", []) if i.get("category") == "food"]
            for i in foods:
                if i.get("veg") == "no":
                    err.append(f'Day {day.get("day")}: "{i.get("name")}" has few vegetarian options. Replace it.')
            if len(foods) < 2:
                warn.append(f'Day {day.get("day")}: needs lunch (13:00) and dinner (20:00) at places with good vegetarian food.')
    elif k == "changes":
        ops = p.get("ops")
        if not isinstance(ops, list) or not ops:
            err.append("changes needs a non-empty ops list")
            ops = []
        if len(ops) > 12:
            warn.append("More than 12 ops: keep it to the smallest set that does what they asked.")
        for n, o in enumerate(ops, 1):
            t = o.get("type") if isinstance(o, dict) else None
            w = f"op {n} ({t})"
            if t not in OPS:
                err.append(f"{w}: unknown type, use one of {OPS}")
                continue
            if t in ("move", "remove", "time", "transport", "veg", "note"):
                if not o.get("itemId"):
                    err.append(f"{w}: needs itemId")
                elif ids is not None and o["itemId"] not in ids:
                    err.append(f"{w}: itemId {o['itemId']} isn't in the snapshot")
            if t in ("move", "add") and o.get("toDay") is not None and ndays and not (1 <= int(o["toDay"]) <= ndays):
                err.append(f"{w}: toDay must be 1 to {ndays}")
            if t == "move" and not o.get("toDay"):
                err.append(f"{w}: needs toDay")
            if t == "day" and ndays and not (1 <= int(o.get("day", 0)) <= ndays):
                err.append(f"{w}: day must be 1 to {ndays}")
            if t == "transport" and o.get("mode") not in MODES:
                err.append(f"{w}: mode must be one of {MODES}")
            if t == "veg" and o.get("veg") not in ("yes", "no", ""):
                err.append(f'{w}: veg must be "yes", "no" or ""')
            if t == "booking" and (o.get("booking") or {}).get("kind") not in BOOKINGS:
                err.append(f"{w}: booking.kind must be one of {BOOKINGS}")
            if t == "check" and (not o.get("text") or o.get("group") not in ("pack", "todo")):
                err.append(f'{w}: needs text and group "pack" or "todo"')
            if t == "add":
                pl = o.get("place") or {}
                if not pl.get("name") or not pl.get("location"):
                    err.append(f"{w}: place needs name and location (street or area)")
                if pl.get("category") and pl["category"] not in CATS:
                    err.append(f"{w}: category must be one of {CATS}")
                if pl.get("category") == "food":
                    if pl.get("veg") == "no":
                        err.append(f'{w}: "{pl.get("name")}" has few vegetarian options. Leave it out.')
                    elif pl.get("veg") != "yes":
                        warn.append(f'{w}: "{pl.get("name")}" is a restaurant: check the menu and set veg "yes" plus a vegNote.')
    elif k == "picks":
        items = p.get("items")
        if not isinstance(items, list) or not items:
            err.append("picks needs a non-empty items list")
            items = []
        for i in items:
            if not i.get("name"):
                err.append("a pick has no name")
            if i.get("category") == "food" and i.get("veg") == "no":
                err.append(f'"{i.get("name")}" has few vegetarian options. Leave it out.')
            elif i.get("category") == "food" and i.get("veg") != "yes":
                warn.append(f'"{i.get("name")}" is a restaurant: set veg "yes" only after checking its vegetarian dishes.')
    elif k == "review":
        if not isinstance(p.get("suggestions"), list):
            err.append("review needs a suggestions list")
    return err, warn


def load(path):
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    try:
        return json.loads(text)
    except ValueError as e:
        sys.exit(f"That file isn't valid JSON: {e}")


def vet(a, s=None):
    p = load(a.file)
    snap = None
    if s and not a.no_snapshot:
        try:
            snap = read_snapshot(s)
        except SystemExit as e:
            print("(couldn't read the plan to cross-check ids: " + str(e).splitlines()[0] + ")", file=sys.stderr)
    err, warn = check(p, snap)
    for w in warn:
        print("warning:", w, file=sys.stderr)
    for e in err:
        print("ERROR:", e, file=sys.stderr)
    if err:
        sys.exit("Not sent. Fix the errors above.")
    return p


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=("read", "check", "send", "paste"))
    ap.add_argument("file", nargs="?", help="payload JSON file, or - for stdin")
    ap.add_argument("--project"); ap.add_argument("--api-key"); ap.add_argument("--token"); ap.add_argument("--host")
    ap.add_argument("--out", help="read: write the snapshot to this file")
    ap.add_argument("--no-snapshot", action="store_true", help="don't cross-check ids against the live plan")
    ap.add_argument("--force", action="store_true", help="send even with warnings only (errors always stop)")
    a = ap.parse_args()
    if a.cmd != "read" and not a.file:
        sys.exit("Give the payload file (or - for stdin).")
    if a.cmd == "read":
        snap = read_snapshot(settings(a))
        text = json.dumps(snap, indent=1, ensure_ascii=False)
        if a.out:
            open(a.out, "w", encoding="utf-8").write(text)
            print(f"Saved the plan to {a.out} ({len(text)} characters).")
        else:
            print(text)
    elif a.cmd == "check":
        s = settings(a) if (os.environ.get("TRIP_TOKEN") or a.token) and not a.no_snapshot else None
        vet(a, s)
        print("Looks fine.")
    elif a.cmd == "paste":
        p = vet(a)
        print("Paste this into the app (More, Connect Claude, Paste from Claude):\n")
        print(json.dumps(p, ensure_ascii=False, separators=(",", ":")))
    else:
        s = settings(a)
        p = vet(a, s)
        entry = {"id": secrets.token_hex(6), "at": int(time.time() * 1000), "json": json.dumps(p, ensure_ascii=False)}
        val = {"mapValue": {"fields": {"id": {"stringValue": entry["id"]}, "at": {"integerValue": str(entry["at"])}, "json": {"stringValue": entry["json"]}}}}
        doc = f"projects/{s['project']}/databases/(default)/documents/bridges/{s['token']}"
        body = {"writes": [{"transform": {"document": doc, "fieldTransforms": [
            {"fieldPath": "inbox", "appendMissingElements": {"values": [val]}},
            {"fieldPath": "inboxAt", "setToServerValue": "REQUEST_TIME"}]},
            "currentDocument": {"exists": True}}]}
        call("POST", f"{base(s)}:commit{q(s)}", body)
        print(f"Sent a {p['kind']} proposal ({len(entry['json'])} characters). The app picks it up within a few seconds if it is open, or next time it opens.")


if __name__ == "__main__":
    main()
```

Quick use:

```bash
export TRIP_PROJECT=our-trips-ab49a TRIP_API_KEY=AIza... TRIP_TOKEN=...   # from the user's message
python3 trip_planner.py read --out plan.json     # then read plan.json
# write payload.json, then:
python3 trip_planner.py send payload.json
```

If the sandbox has **no network**, `read` can't work: ask the user to paste the plan (More, Connect Claude... or the "Copy plan for a Claude review" button on the Smart tab), and finish with the paste fallback in section 8.

## 5. Reading the plan

`read` prints the snapshot, a JSON object. The parts that matter:

- `destination`, `startDate`, `currency`, `budget`, `plannedTotal`, `travellers` (first names), `homeCity`.
- `preferences`: the couple's rules (diet, pace, rest block, splurges). Follow them.
- `days[]`: `day` (1-based), `date`, `title`, `stayingIn`, `weather`, and `schedule[]`, the stops in order, each with `id`, `title`, `category`, `location`, `fixedTime`, `durationMin`, `estStart`, `cost`, `mustDo`, `addedBy` ("suggestion" if it came from the guide or an AI), `notes`, `travelToHere`.
- `ideasNotScheduled[]`: saved places not on a day yet (same fields, with `id`).
- `reactions`: who loved/liked/vetoed which item (`votes`, by first name) and comments. **Never use a vetoed place; put loved places on days first.**
- `bookings`, `checklist`, `spent`, `weatherByDay` (`max`, `min`, `rainPct`, `sunset`), `guidePlaces` (names from the free travel guide, handy for the base list).
- `pendingProposals`: what's already waiting for their review. Don't pile on duplicates.
- `requests`: a request the couple typed under "Ask for a change" and sent to you. Answer it with a `changes` payload whose `request` repeats their words.
- `howToSend`: the payload and op formats (same as this document), in case you don't have the skill.

Always read the snapshot first, even for a simple request: the ids, the days and the existing stops decide what to send.

## 6. Payloads

A payload is one JSON object with a `kind`. Send one payload per `send`. You can send several in a row (for example a `review` and then `changes`).

### 6.1 `changes`: small edits, finds, bookings, packing, vegetarian checks

```json
{
  "kind": "changes",
  "request": "make Day 2 slower",
  "summary": "Moved the Vatican Museums to Day 3, added a long lunch and a rest stop on Day 2.",
  "ops": [
    {"type": "move", "itemId": "k3f9a1x", "toDay": 3, "time": "09:00", "why": "Day 2 had five sights; this halves it."},
    {"type": "time", "itemId": "m81bq0z", "time": "13:00", "why": "A proper lunch before the afternoon."},
    {"type": "remove", "itemId": "p20zzt1", "why": "Too far for the time left. It goes back to Ideas."},
    {"type": "add", "place": {"name": "Roscioli Salumeria con Cucina", "category": "food", "location": "Via dei Giubbonari 21, Rome", "durationMin": 90, "cost": 3000, "why": "Famous carbonara and a real vegetarian menu.", "veg": "yes", "vegNote": "Burrata, cacio e pepe, stuffed zucchini flowers", "url": "https://www.salumeriaroscioli.com"}, "toDay": 2, "time": "13:00"},
    {"type": "add", "place": {"name": "Villa Borghese gardens", "category": "nature", "location": "Piazzale Napoleone I, Rome", "durationMin": 90, "cost": 0, "why": "Quiet green break."}, "toDay": null},
    {"type": "transport", "itemId": "m81bq0z", "mode": "walk", "minutes": 12, "why": "It's close."},
    {"type": "day", "day": 2, "title": "Slow Rome", "base": "Trastevere", "notes": "Start at 10, long lunch."},
    {"type": "veg", "itemId": "q77tt0d", "veg": "yes", "note": "Pizza margherita, fritto misto di verdure"},
    {"type": "note", "itemId": "k3f9a1x", "notes": "Book the 09:00 slot online; the queue is long after 10."},
    {"type": "booking", "booking": {"kind": "hotel", "title": "Hotel Teatro di Pompeo", "ref": "BK48213", "start": "2026-11-10T14:00", "end": "2026-11-13T11:00", "from": "", "to": "", "address": "Largo del Pallaro 8, Rome", "cost": 54000, "currency": "INR", "notes": "Breakfast included"}},
    {"type": "check", "text": "Travel adapter (type L)", "group": "pack"},
    {"type": "check", "text": "Book Colosseum tickets", "group": "todo"}
  ]
}
```

Op reference (every op may also carry `why`, one plain sentence the couple see):

| type | fields | what it does |
|---|---|---|
| `move` | `itemId`, `toDay` (1-based), `time?` | puts a stop on a day (at the end, or in time order if `time`) |
| `remove` | `itemId` | takes a stop off its day back to Ideas. **Never deletes.** |
| `add` | `place{name, category, location, durationMin, cost, why, veg, vegNote, url}`, `toDay` (1-based or `null` for Ideas), `time?` | adds a new place. The app looks it up on the map and drops it with a note if it can't find it, so give a street address. `category`: sight, activity, food, stay, shopping, nature, transport, other. `cost` is in the trip currency, for two. For `food`, `veg` must be `"yes"`. |
| `time` | `itemId`, `time` ("HH:MM", or `""` to clear) | sets or clears a fixed time |
| `transport` | `itemId`, `mode`, `minutes`, `cost?` | how to get TO that stop from the one before it. `mode`: walk, transit, bus, train, car, rental, taxi, bike, ferry, flight |
| `day` | `day`, `title?`, `base?`, `notes?` | names a day, sets the town they stay in, adds a note |
| `veg` | `itemId`, `veg` (`yes`/`no`/`""`), `note` | records a vegetarian check on a restaurant stop |
| `note` | `itemId`, `notes` | replaces the notes on a stop |
| `booking` | `booking{kind, title, ref, start, end, from, to, address, cost, currency, notes}` | saves a booking. `kind`: flight, hotel, train, bus, ferry, car, tickets, other. `start`/`end` are local times `YYYY-MM-DDTHH:MM`. |
| `check` | `text`, `group` (`pack` or `todo`) | adds a packing item or a to-do |

Ops that the app can't apply (an id that's gone, a day out of range, a restaurant with few vegetarian options) are shown greyed with the reason. The couple apply or skip each op, or apply all.

### 6.2 `plan`: fill the days (only when asked)

Same shape the app's own planner uses. The app checks it against their rules (pace, rest block, vegetarian dishes, no airports or stations as stops), finds each place on the map and shows it as a plan they can accept day by day.

```json
{
  "kind": "plan",
  "draft": {
    "summary": "Four days: ancient Rome, the Vatican, Trastevere and a slow day around the Borghese.",
    "days": [
      {"day": 1, "base": "Rome", "theme": "Ancient Rome", "items": [
        {"name": "Colosseum", "category": "sight", "time": "09:00", "durationMin": 120, "address": "Piazza del Colosseo, Rome", "approxCost": 4000, "why": "Go first thing, before the heat and the queue.", "closedDays": "", "bookAhead": true, "veg": "", "vegNote": "", "splurge": "", "market": false},
        {"name": "Roscioli Salumeria con Cucina", "category": "food", "time": "13:00", "durationMin": 90, "address": "Via dei Giubbonari 21, Rome", "approxCost": 3000, "why": "Long lunch with a real vegetarian menu.", "closedDays": "Sundays", "bookAhead": true, "veg": "yes", "vegNote": "Burrata, cacio e pepe", "splurge": "", "market": false}
      ]}
    ],
    "stays": [
      {"name": "Hotel Teatro di Pompeo", "base": "Rome", "address": "Largo del Pallaro 8, Rome", "approxCost": 18000, "why": "Central, quiet courtyard.", "splurge": false}
    ]
  }
}
```

Rules for a plan (these are the app's own rules, so follow them or the app will adjust/drop things):

- Exactly one entry in `days` per trip day (`day` 1..N), grouped by area, finishing outdoor sights before sunset (`weatherByDay[].sunset`).
- Pace comes from `preferences`: usually 3-4 sights a day in cities (never fewer than 2), 2-3 for beach/hill/nature stays.
- **Every day has lunch (13:00) and dinner (20:00)** at places with good vegetarian dishes.
- Do **not** add a rest block; the app adds one and keeps its window free.
- Exactly one food splurge (a named restaurant that can do a serious vegetarian menu), one experience splurge (tour, guide, ticket, class) and one stay splurge (in `stays`, `splurge: true`). Set `"splurge": "food"` or `"experience"` on the item.
- Include one market visit (`"market": true`).
- Never use airports, stations, airlines, terminals, car rental or taxis as stops (travel goes in `transport` ops later).
- Use their saved places from `ideasNotScheduled` (keep the names exactly), put loved ones first, skip vetoed ones.
- For a country or region trip: about one city per 2-3 days, moving at most every 2 days, and set `base` on every day.
- Check opening days against `days[].date` (set `closedDays`), mark `bookAhead` for places that sell out.
- `approxCost` is in the trip currency, for two (stays: per night).

### 6.3 `picks`: top places for the Discover tab

```json
{
  "kind": "picks",
  "items": [
    {"name": "Pizzeria da Baffetto", "category": "food", "rating": 4.4, "reviews": 18000, "priceLevel": "$$", "approxCost": 2500, "area": "Centro Storico", "why": "Classic Roman thin-crust pizza; good marinara, margherita and vegetable toppings.", "durationMin": 75, "address": "Via del Governo Vecchio 114, Rome", "veg": "yes", "vegNote": "Margherita, ortolana, fritto di verdure"},
    {"name": "Palatine Hill", "category": "sight", "rating": 4.7, "reviews": 52000, "priceLevel": "$$", "approxCost": 2000, "area": "Ancient Rome", "why": "Quieter than the Forum, with the best views over it.", "durationMin": 120, "address": "Via di San Gregorio 30, Rome"}
  ]
}
```

Send about 24: 7 sights, 4 activities, 7 restaurants/cafes, 4 stays across price levels, 2 nature spots. Use real, currently open, well-reviewed places (search the web for current ratings) and put a real `rating` and `reviews` count only if you saw them. Restaurants need `veg: "yes"` (the app drops any with `"no"`). Replaces the previous picks.

### 6.4 `review`: a review of the plan

```json
{
  "kind": "review",
  "summary": "A good shape overall, but Day 2 is packed and Day 3 has no lunch.",
  "suggestions": [
    {"title": "Move the Vatican Museums to the morning of Day 3", "detail": "It closes at 18:00 and Day 2 already runs until 21:30.", "action": {"type": "move", "itemId": "k3f9a1x", "toDay": 3}},
    {"title": "Taxi from the hotel to the Colosseum", "detail": "It saves 25 minutes with luggage.", "action": {"type": "transport", "itemId": "m81bq0z", "mode": "taxi", "minutes": 15}},
    {"title": "Add a lunch place near the Pantheon on Day 3", "detail": "Nothing is planned between 11:00 and 17:00.", "action": {"type": "add", "toDay": 3, "place": {"name": "Armando al Pantheon", "category": "food", "location": "Salita dei Crescenzi 31, Rome", "durationMin": 75, "cost": 3500}}},
    {"title": "Book the Borghese Gallery ahead", "detail": "Entry is by timed ticket only.", "action": {"type": "none"}}
  ]
}
```

Each suggestion has a `title` (short imperative), a `detail` (1-2 sentences) and an `action`: `move` (`itemId`, `toDay`), `add` (`place`, `toDay`), `transport` (`itemId`, `mode`, `minutes`), `time` (`itemId`, `time`) or `none`. The app shows an Apply button only when an action is possible. Give 4 to 10, most important first. Check pacing, opening hours and best time of day, geographic grouping, how to get between places, must-dos, balance between what each of them added, budget, weather, and anything missing (meals, rest, check-in times, airport transfers). Flag anything that breaks their rules (vegetarian, rest block, pace). Use `changes` instead when they want the edits ready to apply in bulk.

## 7. How to send

1. `read` the plan. 2. Do the work (search the web, read the link, read Gmail...). 3. Write the payload file. 4. `python3 trip_planner.py send payload.json` (it checks first: fix every ERROR, think about every warning). 5. Tell the user, in plain words, what you sent and where to find it:

- `changes`: "On the Plan tab you'll see 'Claude suggests 6 changes'. Tap Review, then Apply or Skip each one."
- `plan`: "On the Plan tab, tap Review under 'Claude drafted a plan' and use each day you like."
- `picks`: "Open Discover: the top picks are there, tap Add on the ones you like."
- `review`: "Open Smart: the review is at the top, tap Apply on the ones you agree with."

The app picks proposals up within a few seconds if it is open on either phone, and otherwise the next time someone opens the trip. The inbox holds at most 30 entries, so don't send more than a handful at once.

A good way to work a request: read, think, send **one** focused payload, and ask a question rather than guess when something important is missing (dates, which day, which hotel).

## 8. No network? Paste fallback

If your session can't reach the internet, ask the user to paste the plan to you (in the app: Smart tab, "Copy plan for a Claude review"), then:

1. Write the payload exactly as above.
2. Run `python3 trip_planner.py paste payload.json` (or just print the JSON yourself). It prints one line.
3. Tell the user: "Open the trip, More, Connect Claude, open 'Claude has no internet? Paste its answer here', paste the line and tap Done." The app accepts any payload kind (`plan`, `changes`, `picks`, `review`), with or without a ```json fence, and also the older plain plan answer (`{"summary":..., "days":[...]}`).

The same box is also offered after "Ask Claude" (under the Plan tab's "Ask for a change") when the Claude link isn't connected.

## 9. Recipes

**Change request ("make Day 2 slower", "swap the museum and the walk").** Read the plan, find the ids, send `changes` with the smallest set of `move`/`time`/`remove`/`add`/`transport`/`day` ops, each with a `why`. Check opening hours and travel time before moving things. Keep the rest block and lunch/dinner. Put a removed stop back in Ideas (`remove`), not gone.

**Top picks.** Search the web for the destination's best-reviewed sights, activities, food, stays; send `picks` (6.3). Prefer places near the days' bases (`days[].stayingIn`). Skip things already in the plan.

**Vegetarian check.** For each restaurant in the plan (`category: "food"`, esp. where the card shows no veg tag), search its menu and reviews. Send `veg` ops: `yes` with `note` naming dishes, or `no` when there's little or nothing vegetarian, and add a `changes` suggestion (a replacement `add`, plus a `move` or `remove`) when it's a `no`.

**Links and screenshots.** The user shares an Instagram/blog/maps link or a screenshot. Read it (open the link, or read the image), list every real place it recommends (at most 10), find each one's address, and send `add` ops with `toDay: null` (Ideas) unless they said where. Restaurants get `veg` + `vegNote`. Say which places you couldn't identify.

**Review.** Send `review` (6.4).

**Bookings from Gmail.** Search their Gmail (Gmail connector) for confirmations: airlines, hotels, trains, tickets for the trip dates and destination. Read each email, and send one `booking` op per booking with only what the email says (`ref`, local `start`/`end`, `from`/`to`, `address`, `cost`, `currency`). Skip anything already in `bookings` (same `ref`). If two emails disagree, ask. Offer to add a hotel stay's town as the day `base` (a `day` op) for those nights.

**Packing and to-dos.** From `weatherByDay`, the stops (hikes, temples, beaches), the destination (abroad: passport, visa check, forex card, travel insurance, plug adapter) and bookings (download tickets), send `check` ops: `pack` for things to bring, `todo` for things to do or book ("Book Colosseum tickets"). Don't repeat what's already in `checklist`. Keep it short and specific.

**Plan the days.** Only on request. Read everything (including `reactions` and `ideasNotScheduled`), then send one `plan` (6.2) and tell them to review it day by day.

## 10. If something goes wrong

- `HTTP 403` on read: the link is off or the Firestore rules for the Claude link aren't published. Ask the user to check More, Connect Claude, or to run the rules update (HANDOFF-rules-update.md in the app's repository).
- `HTTP 404`: wrong token, or the user turned the link off or made a new one. Ask for a fresh "Copy for Claude".
- "The plan isn't ready": the app writes the snapshot a few seconds after the trip is open. Ask them to open the trip, wait, retry.
- Nothing shows up in the app: it processes the inbox only while the trip is open. Ask them to open it.
- Something shows greyed with "Can't apply": the plan changed since you read it. Read again and send a fresh payload.
