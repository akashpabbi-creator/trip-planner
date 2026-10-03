# Our Trip Planner

A free, private web app for planning a trip together. Both of you edit the same plan at the same time and see each other's changes instantly.

## What it does

- **Save inspiration from anywhere.** Paste a link (Instagram, Facebook, Google Maps, blogs, hotel sites). The app pulls the title, photo, description and, where it can, the location. On Android you can install the app and use **Share → Trips** straight from Instagram or Chrome.
- **Links go straight into the plan.** The app reads each shared link: the places it mentions (a caption listing five cafés becomes five stops), what kind of place each is, opening hours, prices, whether a restaurant is vegetarian, and the best time to go (sunrise, sunset, evening). Each place goes onto the day it fits best: near what is already planned, with room left, at the right time of day. A restaurant takes over a travel-guide meal slot, and on a full day a travel-guide pick moves back to Ideas, so your own finds always win. With a Gemini key, Gemini reads the page itself for better results. You can switch this off under Discover → Edit preferences.
- **Ideas → days.** Saved links land in *Ideas*. Drop them onto days, reorder with ↑/↓ (moving past the end of a day hops to the next day), set fixed times or let the app estimate them.
- **Grow or shrink the trip.** Go from 2 to 5 days (or back). Removing a day sends its stops back to Ideas, so nothing is lost.
- **Getting around.** Between every two stops you can record how you'll travel (walk, metro/bus/train, own car, rental car, taxi, ferry, flight), how long it takes and what it costs, with a one-tap Google Maps directions link.
- **Budget.** Expected budget vs. planned spend, split by category, by day and per person, plus extra costs like flights home or visas.
- **Live together.** Shows who's online, flashes cards the other person just changed, and every card says who added or edited it and when.
- **Changes log.** A timeline of every change with the time and who made it.
- **Plan check.** Warns about must-dos that aren't scheduled yet, days that run too late, impossible timings and going over budget.
- **✨ Smart plan.** One button reviews the whole plan and suggests fixes you can apply with one tap: a shorter order for each day's stops, the best way to get between stops (walk, public transport, taxi, train, or hiring a car for the day), overloaded days and where to move things, unscheduled must-dos and the best day for them, empty days to fill with nearby ideas, long moves between towns, whether both of your picks made it in, and what to cut when over budget. Set your pace (relaxed, balanced, packed), how you like to get around and how late you want to finish. It runs in the browser using free OpenStreetMap lookups, so it costs nothing and needs no AI key. Travel times are estimates; the Directions link gives exact times and fares.
- **Your preferences built in.** Each trip starts from your Trip Sheet preferences: vegetarian food (eggs fine), street food and markets plus one notable restaurant, a rest block every afternoon, and one splurge each in food, stay and experience. The pace is picked per destination: full days in big cities, slow days at beaches and hills. When a trip opens, its empty days are filled with a sample itinerary built from the travel guide around these rules, and stays and backup options go to Ideas. Edit the preferences under Discover; the Smart checks and Gemini follow them too.
- **Discover.** Opening a trip loads a cover photo and short description of the destination (Wikipedia), the weather for your dates (Open-Meteo: a forecast close to the trip, otherwise last year's weather on the same dates) and the travel guide's picks for sights, things to do, food, drinks and places to stay (Wikivoyage). A starter set is added to Ideas automatically. With a free Gemini key, "Top rated, picked by Gemini" adds Google-rated restaurants, sights and hotels.
- **Gemini review.** In the Smart tab, Gemini reads the whole plan and suggests changes (timing, opening hours, what to add, how to get around). Most come with an Apply button. "Copy plan for Claude" copies the plan so you can ask Claude for a review instead.
- **Itinerary.** A clean day-by-day itinerary you can print, save as PDF or copy as text.

## Link previews: what works

| Source | What you get |
|---|---|
| Websites, blogs, hotels, restaurants | Title, photo, description. Location when the site publishes it. |
| Google Maps links | Place name and location, read from the link itself. |
| Instagram public posts/reels | Usually the caption and photo; location if the caption has a 📍. Private posts and some reels only save the link. |
| Facebook | Often blocked by Facebook. The link is always saved, and the app asks you to type a name and location. |

Previews use the free [Microlink](https://microlink.io) service (about 50 lookups a day per device), with a free fallback. If a preview fails the link is still saved.

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
2. Click **Invite** and add your partner's Gmail address. They open the same link, sign in, and the trip is there.
3. On phones, use the browser's **Add to Home screen**. On Android this also adds "Trips" to the share menu.

## Try it without setup

Leave `config.js` as is and open `index.html` through any local web server (`python3 -m http.server`). It runs in demo mode with data stored in that browser; open two tabs with different names to try joint editing.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `store.js`: Firebase and demo data layers
- `unfurl.js`: link previews
- `smart.js`: the Smart plan engine
- `discover.js`: destination photo, weather and travel guide picks
- `ai.js`: Gemini top picks and plan review
- `profile.js`: your travel preferences and the sample itinerary
- `linkinfo.js`: reads places, hours, prices and best times from shared links
- `firestore.rules`: privacy rules to paste into Firebase
- `manifest.webmanifest`, `sw.js`, `icons/`: installable app + share target
