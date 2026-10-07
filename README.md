# Our Trip Planner

A free, private web app for planning a trip together. Both of you edit the same plan at the same time and see each other's changes instantly.

## What it does

- **Save inspiration from anywhere.** Paste a link (Instagram, Facebook, Google Maps, blogs, hotel sites). The app pulls the title, photo, description and, where it can, the location. On Android you can install the app and use **Share → Trips** straight from Instagram or Chrome.
- **Links go straight into the plan.** The app reads each shared link: the places it mentions (a caption listing five cafés becomes five stops), what kind of place each is, opening hours, prices, whether a restaurant is vegetarian, and the best time to go (sunrise, sunset, evening). Each place goes onto the day it fits best: near what is already planned, with room left, at the right time of day. A restaurant takes over a travel-guide meal slot, and on a full day a travel-guide pick moves back to Ideas, so your own finds always win. With a Gemini key, Gemini reads the page itself for better results. Whole-country trips (say, Italy) work too: the sample plan gives each of the top cities a block of days with "Staying in" set, and links land on the days in the matching city. You can switch this off under Discover → Edit preferences.
- **Vegetarian check.** Every restaurant is checked for vegetarian food. It doesn't have to be a pure-veg place, only to serve proper vegetarian dishes. Cards show 🥗 Veg options or ⚠️ Few veg options. Places built around meat or fish (steakhouses, seafood shacks, BBQ) are left out of the sample plan, and with a Gemini key every restaurant is checked against menus and reviews, with what to order. The Smart tab offers to swap a planned restaurant with few vegetarian options for a nearby one that has them.
- **Ideas → days.** Saved links land in *Ideas*. Drop them onto days, reorder with ↑/↓ (moving past the end of a day hops to the next day), set fixed times or let the app estimate them.
- **Grow or shrink the trip.** Go from 2 to 5 days (or back). Removing a day sends its stops back to Ideas, so nothing is lost.
- **Getting around.** Between every two stops you can record how you'll travel (walk, metro/bus/train, own car, rental car, taxi, ferry, flight), how long it takes and what it costs, with a one-tap Google Maps directions link.
- **Budget.** Expected budget vs. planned spend, split by category, by day and per person, plus extra costs like flights home or visas.
- **Live together.** Shows who's online, flashes cards the other person just changed, and every card says who added or edited it and when.
- **Changes log.** A timeline of every change with the time and who made it.
- **Plan check.** Warns about must-dos that aren't scheduled yet, days that run too late, impossible timings and going over budget.
- **✨ Smart plan.** One button reviews the whole plan and suggests fixes you can apply with one tap: a shorter order for each day's stops, the best way to get between stops (walk, public transport, taxi, train, or hiring a car for the day), overloaded days and where to move things, unscheduled must-dos and the best day for them, empty days to fill with nearby ideas, long moves between towns, whether both of your picks made it in, and what to cut when over budget. Set your pace (relaxed, balanced, packed), how you like to get around and how late you want to finish. It runs in the browser using free OpenStreetMap lookups, so it costs nothing and needs no AI key. Travel times are estimates; the Directions link gives exact times and fares.
- **Your preferences built in.** Each trip starts from your Trip Sheet preferences: vegetarian food (eggs fine), street food and markets plus one notable restaurant, a rest block every afternoon, and one splurge each in food, stay and experience. The pace is picked per destination: full days in big cities, slow days at beaches and hills. When a trip opens, its empty days are filled with a sample itinerary built from the travel guide around these rules, and stays and backup options go to Ideas. Edit the preferences under Discover; the Smart checks and Gemini follow them too.
- **🤖 Gemini plans the days.** With a Gemini key, "Ask Gemini to plan the days" (Discover) drafts the whole trip from your preferences using Google Search. The app's rules then check the draft: airports and stations are dropped, restaurants with few vegetarian options are dropped, the 3pm rest block is kept free, over-full days send extras to Ideas, places closed on that weekday move to Ideas, missing meals are filled from the travel guide, and any place that can't be found on the map is left out. Missing splurges, a missing market and going over budget are flagged. The draft waits on the Plan tab for either of you to review: use one day at a time or the whole plan, try again, or discard it. Without a key, the rule-based sample plan is used. "Rebuild the sample plan" takes out travel-guide stops nobody has edited and plans the days again.
- **Bot checks and articles.** Sites that answer link readers with a robot check are skipped and read another way. "Where to eat in…" style articles are read in full and each place heading becomes a stop.
- **Discover.** Opening a trip loads a cover photo and short description of the destination (Wikipedia), the weather for your dates (Open-Meteo: a forecast close to the trip, otherwise last year's weather on the same dates) and the travel guide's picks for sights, things to do, food, drinks and places to stay (Wikivoyage). Days stay empty until you ask: "Fill empty days" builds a sample from the guide and your preferences, or plan with Gemini or Claude. With a free Gemini key, "Top rated, picked by Gemini" adds Google-rated restaurants, sights and hotels.
- **Gemini review.** In the Smart tab, Gemini reads the whole plan and suggests changes (timing, opening hours, what to add, how to get around). Most come with an Apply button. "Copy plan for Claude" copies the plan so you can ask Claude for a review instead.
- **Itinerary.** A clean day-by-day itinerary you can print, save as PDF or copy as text.
- **Map.** A Map tab shows every day's stops as numbered pins in that day's colour, joined by a line, with your Ideas as grey pins. Pick a day with the chips along the top, tap a pin to add it to a day or get directions, or switch to the list. Each day has a small Map button that opens the map on that day. Places without coordinates are listed so you can find them.
- **Stops along the way.** On a long drive (more than 25 km between two stops) a "Stops along the way" link lists viewpoints, sights, castles, waterfalls and restaurants with vegetarian food close to the road, ranked by how well known they are and how small the detour is. One tap adds a stop between the two.
- **Reactions and comments.** Every card has a quiet row: ❤️ 👍 👎 (one choice each, tap again to clear) and 💬 for a short thread. Cards you both love get a "Both love it" badge. Ideas can be filtered by kind and sorted with both-loved first; anything either of you votes 👎 is left out when a plan is drafted.
- **Screenshots.** The 📷 button reads places from screenshots (an Instagram reel, a map list, a magazine page) with Gemini and adds them like a shared link. The picture is never saved. On Android you can also share images straight to the app.
- **Bookings.** Kit → Bookings keeps flights, hotels, trains and tickets in one place with times, confirmation codes (tap to copy), addresses and cost. Paste a confirmation email and the details fill in (Gemini if you have a key, otherwise a built-in reader), then you confirm. Bookings show as a small strip on the right day, count in the budget, and a hotel can set "staying in" for its nights.
- **Price checks.** Kit → Check prices opens Google Flights, Google Hotels and Booking.com searches for your dates and each place you stay. Nothing is booked from the app. Add your home city to start the flight search from there; it's optional.
- **Today.** While the trip is on, the Plan tab opens at today's day and starts with a Today card: the stop you're on, the next one, when to leave, one-tap Directions, today's weather and bookings with their codes. It works offline from what the phone already has.
- **Kit checklist.** Shared packing and to-do lists with live tick boxes that show who ticked what. "Suggest items" adds rule-based ideas once (rain gear for wet days, sunscreen for hot ones, passport and insurance abroad, "download tickets" for bookings), and you can add your own.
- **Spending log.** Budget → Spent so far logs what you actually pay, in any currency, converted to the trip currency with free exchange rates. See planned against spent against budget, a list by day, and, if you turn it on, who owes whom.
- **Calendar and My Maps export.** The Itinerary tab gives you an `.ics` calendar file (every stop and booking with its time) and a `.kml` file for Google My Maps (a folder per day plus Ideas). Each day also has a Route link that opens the whole day as one Google Maps route.
- **Ask for a change.** One line on the Plan tab: type "make Day 2 slower" and ask Gemini or Claude. The answer arrives as a short list of changes in plain words (move, add, remove to Ideas, new time, how to get there, a note, a booking, a packing item). Apply them one by one, all together, or discard. Nothing changes until you tap.
- **Paste anything.** The 📝 button next to the link box (or pasting a long text into the link box) turns a friend's WhatsApp tips, a video transcript, a blog post or someone's itinerary into places. Gemini or Claude reads it once, the text isn't saved, and you review every place before it's added.
- **Shuffle a day.** 🔀 Shuffle under a day swaps a few stops for places already in Ideas (same kind of place, near your other stops, loved ones first). It never touches must-dos, fixed times or places you both love, and nothing changes until you Apply.
- **Connect Claude.** More → Connect Claude links the trip to a Claude chat so Claude can plan, answer change requests, find top places, check restaurants for vegetarian food and read links, screenshots and booking emails, all free with your Claude account. See "Claude link" below. Once connected, every Claude button (and the quick buttons in the Connect Claude sheet) opens Claude with your trip link and the request already filled in: one tap, then send.
- **Easy on the phone.** A bottom bar (Plan, Map, Ideas, Kit, More), a small "Saved / Saving / Offline" indicator at the top, one-tap Directions on every stop and big enough buttons to hit with a thumb.

## Offline

- The app shell, the Firebase SDK and the fonts are cached by the service worker, so the app opens with no signal (after one online visit). Trips you've opened are kept on the phone.
- You can keep editing offline: changes show straight away, are queued, and sync when you're back online (the top indicator says "Offline / Saving / Saved"). If two people edit the same list offline, the last one to sync wins.
- Deleting a trip, the Claude link and link previews need a connection. On iPhone, add the app to the Home Screen and open it once online so it can cache itself.
- Updates: when a new version is deployed, an open app shows "New version ready · Refresh". Tap it to load the new code. (Maintainers: bump `CACHE` in `sw.js` on each release.)

## Link previews: what works

| Source | What you get |
|---|---|
| Websites, blogs, hotels, restaurants | Title, photo, description. Location when the site publishes it. |
| Google Maps links | Place name and location, read from the link itself. |
| Instagram public posts/reels | The full caption (read from Instagram's public embed page) and photo. A caption that lists several places becomes several stops. Private posts only save the link. |
| Facebook | Often blocked by Facebook. The link is always saved, and the app asks you to type a name and location. |

Previews use the free [Microlink](https://microlink.io) service (about 50 lookups a day per device), with a free fallback. If a preview fails the link is still saved.

## Friends, and AI only for one account

The planner is one app for everyone. Gemini and Claude are only for accounts listed in the `aiUsers` collection; everyone else gets the same planner with no Gemini or Claude buttons or text (the rule-based features stay: Fill empty days, travel guide, link reader, bookings email reader, map, budget, kit, ideas, votes).

- **Make an AI user.** In the Firebase console, Firestore → Start collection `aiUsers`, document id = the lowercase Google email, any field (for example `on: true`). The app never writes it, and no email is in the code.
- **Where the secrets live.** The Gemini key and the Claude link token are saved in `private/{email}` (`ai` and `bridges.{tripId}`), which only that account can read, and only if it has an `aiUsers` doc. They are no longer on the trip, so people sharing a trip can't see them. When an AI user opens a trip that still has `ai` or `bridge` on it from an older version, the app moves them to the private doc and clears them from the trip. Until that account opens the trip, the old values are still on it.
- **Invite link.** Invite (top of a trip) → Invite link → Create. Share or copy it; anyone who opens it and signs in with Google joins the trip. Reset link makes a new one and the old one stops working. The owner can also Remove people; everyone else can Leave this trip. Invite by email still works.
- **iPhone.** In Safari (not yet on the Home Screen) the app shows a one-time tip to add it to the Home Screen and sign in in Safari first.
- **Rules.** Publish the new `firestore.rules` (they add `aiUsers`, `private`, `joins`, leaving a trip, joining by link, and make the Claude link AI-user only).
- **Demo mode.** Everyone is an AI user, unless the address has `?noai` or `localStorage["tripplanner-demo-noai"] = "1"`.

## Claude link

Connect Claude (More → Connect Claude) lets a Claude chat in the Claude desktop app or Cowork read your plan and send proposals, using the "trip-planner" skill in `docs/claude-skill.md`.

- **What it does.** The app keeps a read-only copy of the plan (stops, ideas, votes, bookings, checklist, spend totals, weather; never your Gemini key or anyone's email) in a private document named by a secret link. Claude reads it and sends back a plan, a list of changes, top picks or a review. They arrive on the Plan or Smart tab as proposals; nothing is applied until one of you taps Apply.
- **Needs the new database rules once.** The Firestore rules in `firestore.rules` now include the Claude link. Publish them once in the Firebase console (Firestore → Rules). `HANDOFF-rules-update.md` in the project files (not in this repository) has a ready-made brief for a Claude desktop or Cowork session to do it.
- **The link is a secret.** Anyone who holds it can read the plan and send proposals, but can't change the plan or read anything else. Share it only with your own Claude chat. If it leaks, use "Make a new link".
- **Turn it off any time.** More → Connect Claude → Turn off. The link stops working straight away. Without a connection Claude can still help: copy the plan, paste Claude's answer into the Connect Claude box.

## Free services used

Everything runs on free services with no keys: OpenStreetMap (map tiles and place search), OSRM (road routes for Stops along the way), Overpass (places near a route), Open-Meteo (weather), Wikipedia and Wikivoyage (destination and guide), Microlink (link previews), and Frankfurter with open.er-api.com as a fallback (exchange rates for the spending log). Leaflet (the map library) is loaded from unpkg. The only optional key is your own free Gemini key.

## Cost

Free. Firebase's free "Spark" plan (no card needed) gives 50,000 reads and 20,000 writes a day, far more than two people planning a trip will use. Hosting on GitHub Pages is free.

## Privacy

You sign in with Google. A trip is visible only to the email addresses on it; the database rules (`firestore.rules`) enforce this on Google's servers, so even someone with the link can't read it. The Firebase config in `config.js` is not a secret; it only identifies the project.

## Setup (one time, about 10 minutes)

A Claude desktop or Cowork session can do all of this for you: see `HANDOFF-desktop-session.md`. The manual steps are below.

The Gemini key comes from https://aistudio.google.com/apikey. It's free with any Google account and separate from a Gemini app subscription. Paste it in the app under ✨ Smart → Connect Gemini. Never put it in the repository.

### 1. Firebase (login + live database)
1. Go to <https://console.firebase.google.com>, click **Create a project**, name it (e.g. `our-trips`), turn Google Analytics off.
2. **Build → Authentication → Get started → Google → Enable**, pick your support email, Save.
3. **Build → Firestore Database → Create database**, pick a location near you, choose **production mode**.
4. In Firestore open the **Rules** tab, replace everything with the contents of `firestore.rules`, click **Publish**.
5. **Project settings (⚙️) → Your apps → Web (`</>`)**, register an app (no hosting), and copy the `firebaseConfig` values into `config.js`.

### 2. Hosting (GitHub Pages)
1. Put these files in a GitHub repository (e.g. `trip-planner`).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save.**
3. Your app will be at `https://<your-github-username>.github.io/trip-planner/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.

### 3. Use it
1. Open the app, sign in with Google, create a trip.
2. Click **Invite** and add a Gmail address, or create an invite link and send it. They open the app (or the link), sign in, and the trip is there.
3. On phones, use the browser's **Add to Home screen**. On Android this also adds "Trips" to the share menu.

## Try it without setup

Leave `config.js` as is and open `index.html` through any local web server (`python3 -m http.server`). It runs in demo mode with data stored in that browser; open two tabs with different names to try joint editing.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `store.js`: Firebase and demo data layers
- `unfurl.js`: link previews
- `smart.js`: the Smart plan engine
- `map.js`, `along.js`: the Map tab and Stops along the way
- `social.js`: reactions, votes and comments
- `proposal-social.js`: 👍/👎 votes and a comment thread on proposed changes and drafted plans (advisory only)
- `capture.js`: screenshots and shared images
- `bookings.js`, `kit.js`: bookings, price checks, Today, checklist, spending log and exports
- `changes.js`, `bridge.js`: Ask for a change and the Claude link
- `paste.js`, `shuffle.js`: places from pasted text, and Shuffle a day
- `docs/claude-skill.md`: the skill file for Claude
- `discover.js`: destination photo, weather and travel guide picks
- `ai.js`: Gemini top picks and plan review
- `profile.js`: your travel preferences and the sample itinerary
- `linkinfo.js`: reads places, hours, prices and best times from shared links
- `firestore.rules`: privacy rules to paste into Firebase
- `manifest.webmanifest`, `sw.js`, `icons/`: installable app + share target
