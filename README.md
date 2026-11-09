# Card Vault

A private, PIN-locked trading card catalogue. Photograph a card and the app:

1. **Identifies it** with Google Gemini (free tier) — player/character, year, maker, set, number, parallel, grade.
2. **Values it** from a web search for recent sales of that card (eBay, 130point, PSA, PriceCharting…), shown in **AUD**.
3. **Finds a clean picture** of the card online (Brave image search, or the official Pokémon TCG database for Pokémon) and stores that instead of your photo. Your photo is kept too, for condition reference.
4. **Files it into its collection/set**, with totals per set and for the whole vault.

**Save for later:** snap cards (or upload a batch from your camera roll) without waiting for identification. Photos are stored immediately in a waiting list; identify them one by one with the review screen, or tap **Identify all** to file them automatically.

Also: search and filter, per-card editing, "Update value" to re-price later, change picture, CSV export (handy for insurance), and it installs to your phone's home screen.

Stack: Next.js 16 on Vercel · Supabase (Postgres + Storage) · Gemini API (free tier) · Brave Search API (free monthly credit). **Runs at $0/month for a personal collection.**

---

## Setup (about 20 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) — pick the **Sydney** region.
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and **Run**. This creates the `cards` table, a login-throttling table, and the `card-images` storage bucket.
3. Go to **Project Settings → API Keys** and copy:
   - the **Project URL** → `SUPABASE_URL`
   - the **secret** key (or legacy **service_role** key) → `SUPABASE_SERVICE_ROLE_KEY`

   This key stays on the server only. Row Level Security is on with no policies, so the public key can't read anything.

### 2. Gemini API key (free)
Go to [aistudio.google.com](https://aistudio.google.com), sign in with a Google account, click **Get API key → Create API key** → `GEMINI_API_KEY`.
Don't link a billing account to that Google Cloud project — without billing it stays on the free tier and can never charge you. Note that Google may use free-tier requests (your card photos) to improve its products.

### 3. Brave Search API key (prices + clean card pictures)
Sign up at [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com), subscribe to the **Search** plan, and create a key → `BRAVE_SEARCH_API_KEY`.
Brave gives $5 of free credit each month (about 1,000 searches). Each scan uses two (one for prices, one for pictures), so that's ~500 free scans a month. A credit card is required, and the free credit requires a Brave attribution on the site — that's already in the footer.

To make sure you're never charged, set a **usage limit of $5** in the Brave dashboard if it offers one, and keep an eye on usage during a big cataloguing session.

Without this key the app still works; it uses your photo and Gemini's own knowledge for rough values.

### 3b. Tavily API key (optional, recommended — doubles the free searches)
Sign up at [app.tavily.com](https://app.tavily.com) (no credit card) and copy the key → `TAVILY_API_KEY`.
The free plan has 1,000 searches a month. The app uses Tavily first and switches to Brave when Tavily runs out, so together that's about 2,000 free searches a month. With Tavily one search usually returns both prices and pictures, so a scan typically costs 1 search instead of 2.

### 4. Deploy to Vercel
1. Push this folder to a new **private** GitHub repo.
2. In [vercel.com](https://vercel.com) → **Add New → Project** → import the repo (framework is detected automatically).
3. Under **Environment Variables**, add these. (Tip: you can paste several `NAME=value` lines into the first Key box at once.) If you created Supabase from Vercel's **Storage** tab, the two Supabase values are already there:

| Variable | Value |
|---|---|
| `APP_PIN` | Your first PIN (used to create the first profile) — use 6 or more digits |
| `SUPABASE_URL` | From step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 1 |
| `GEMINI_API_KEY` | From step 2 |
| `BRAVE_SEARCH_API_KEY` | From step 3 |
| `TAVILY_API_KEY` | From step 3b (optional) |

4. **Deploy**. Open the URL, enter your PIN, and tap **+ Add card**.
5. On your phone: Share → **Add to Home Screen** for an app-like icon.

### Speed: keep the server next to the database
`vercel.json` runs the app's server in Sydney (`syd1`), next to a Sydney Supabase project. If your Supabase project is in another region, change `regions` in `vercel.json` to the nearest Vercel region — every screen makes several database calls, so distance matters.

### Run locally (optional)
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
```

---

## Updating an existing database
If you set up Supabase before the waiting list was added, run `supabase/migrations/002_waiting_list.sql` once in the SQL Editor. (New setups get it from `schema.sql`.)

## Profiles (several people, separate collections)
Each person gets a profile with their own PIN, cards, collections and waiting list. Nobody can see another profile's cards — every database query is locked to the signed-in profile on the server.

- **First time after upgrading:** run `supabase/migrations/003_profiles.sql` in the Supabase SQL Editor. The sign-in screen then asks for your name and your current `APP_PIN`; that creates your (admin) profile and moves all existing cards into it.
- **Adding someone:** tap your name (top right) → **Profiles** → **Add a profile**, with a starting PIN. They pick their name on the sign-in screen and can change their PIN on the same page.
- Admins can reset PINs, make others admin, and delete a profile (with all its cards). Admins see card counts only, never the cards.
- Everyone shares the same Gemini, Tavily and Brave free allowance.
- `APP_PIN` is only used for that first setup.

## Sets & checklists (tick off cards like a binder)
Run `supabase/migrations/005_sets.sql` once.
- After you scan the first card from a new set, the app asks: **track the whole set** or **just this card**. Collections you didn't track are listed on the **Sets** tab with a *Track set* button.
- **Preview before tracking:** on the Sets tab, tap any collection under *Collections you could track* to see every card in the set, with the ones you have ticked and a rough cost to complete. It's free if the checklist is already in the shared library (or it's Pokémon); otherwise **Load the full checklist** uses 1 search and saves it to the library, so tracking it afterwards costs no extra search.
- Tracking uses the set's checklist from the **approved set list** or the shared library (no searching). If there isn't one yet, an admin adds it (see *Add a set*), or you can paste your own on the set page (one card per line, e.g. `1 Captain America`). **Web search (last resort)** is still on the set page's options, clearly labelled; it uses up to 2 searches. Cards filed in a set but not on its checklist are listed on the set page so you can spot wrong identifications.
- Set page: **Grid**, **List** or **Binder** view (remembered per device), All/Owned/Missing filter, completion ring, value owned and rough cost to complete. Tap a missing card to tick it; **Tick off cards** mode lets you tap or drag across many.
- Ticked cards are real cards in your collection and count toward your total.
- **Pictures for ticked cards:** with *Find pictures when I tick* on (the default, remembered per device), each ticked card gets a picture in the background — 1 image search per card. *Find pictures for N cards* catches up on ticked cards that have none. Your own photos are never replaced; Pokémon cards already come with official pictures. Stops automatically at the monthly search limit.
- **Values:** one price lookup per set gives every card a rough estimate (1 search). It only fills in cards that have no value — anything you scanned or re-valued keeps its value. Open any card and tap **Update value** for its own price.
- Unticking a card you scanned with a photo asks first. *Stop tracking* removes the checklist only; your cards stay.

## Shared card library (saves searches)
Run `supabase/migrations/006_shared_library.sql` once.
- Anything found **online** is saved once and reused by every profile: set checklists (and the set's price estimates), clean card pictures, and card prices. Your own photos and your cards are never shared.
- A card someone has already scanned costs no picture search, and no price search if it was priced in the last 30 days. Tracking a set someone already tracks costs nothing.
- "Update value" always looks again, and refreshes the shared price for everyone.
- Admin page → **Fill from existing cards** adds everyone's existing online pictures, recent prices and checklists in one go (no searches used).

## Sharing (read-only)
Run `supabase/migrations/007_sharing.sql` once. Then Profiles → **Sharing**.
- **Read-only link:** anyone with the link sees your collection, sets, wishlist (missing cards from your tracked sets) and spares — no PIN, nothing can be changed. Choose whether values show. **New link** makes the old one stop working; **Turn off** disables it.
- **Share with people in Card Vault:** pick a profile from the list. They get **Shared with you** on their home screen, and **Trade matches**: your spares they're missing, and theirs you're missing (matched by set and card number).
- Never shown: notes, the backs of your photos, cards waiting to be identified.
- **Preview what others see** shows your own view, including your wishlist and spares.

## Approved set list (admins)
Run `supabase/migrations/008_set_catalog.sql` once. Then Admin overview → **Set list**.
- Every set name in use, with card and profile counts only (never the cards). New names from scans show as **Pending**.
- **Possible duplicates** are grouped (same words in any order, "93-94" = "1993-94"). Pick or type the approved name and **Merge**: everyone's cards are filed under it — nothing else on their cards changes. Old spellings become aliases, so future scans and edits snap to the approved name.
- Approved sets: rename (cards follow), category / year / maker, and the **checklist** — load from a link, find online, or type/paste and edit it. Saving a checklist updates it straight away for everyone tracking the set (cards re-matched by player; ticked cards stay ticked).
- Scans choose from the approved list, and the collection dropdown shows approved sets (✓).

## Add a set (admins) — the free route for checklists
Admin overview → Set list → **+ Add a set**. Only admins can open it; what they add is the approved list everyone scans against.
- **Pokémon:** a searchable catalogue of every set from the free Pokémon TCG API. **Add** loads the full checklist, with official pictures and market prices, into the approved list and the shared library. If that API is down (its owners plan to retire it), the free TCGdex API is used instead, and sets already added stay in the library either way.
- **Everything else** (sports, Marvel, Simpsons…): paste a link to a checklist page, or upload a CSV (columns like Number, Name and optionally Subset; comma, tab or semicolon). A collection export works too, and only the named set's rows are kept. You get the list to check and edit (with warnings for gaps or repeated numbers) before **Save to shared library**. Saving updates everyone already tracking the set.
- *Search the web* is there only as a last resort.

## Scanning: pick the set first
- On **Add a card**, choose the set first. It remembers the last set, and **Scan cards into this set** on a set page opens it ready. Identify stays off until a set is chosen.
- The AI then reads only the card number and name and matches them to that set's checklist. It never names the set; the card is saved under the set you picked, spelled as approved. A banner says how it matched. If a player has two cards in the set and there's no back photo, it picks the one nearest your other cards and shows both numbers to tap.
- Insert cards that aren't on the base checklist are saved as read and marked as an insert. A set with no checklist yet saves exactly what was read.
- **Not listed — let the AI guess the set** is the last resort: the old web-search identification, where the AI names the set itself (it can be wrong).
- Waiting-list photos, bulk uploads and **Re-identify** use the chosen set too.

## Admin overview, backups & keep-awake
- Profiles → **Admin overview** (admins only): totals for everyone and a per-profile table — numbers only, never anyone's cards.
- A daily job (`vercel.json` → `/api/cron/daily`, about 4am Sydney) keeps the free Supabase project from pausing and saves a backup of all card details to a private `backups` storage folder (14 days kept). Download or **Back up now** from the admin page. Pictures aren't included. Optional: set `CRON_SECRET` in Vercel so only Vercel can trigger it.

## Usage meter (shared free allowance)
Run `supabase/migrations/004_usage.sql` once. The app then counts every Tavily and Brave search and Gemini request, per profile.
- Home, Add card and Profiles show **~scans left this month** with a reset countdown; tap it for the breakdown by profile.
- **Safety stop:** at 1,000 Brave searches (and 1,000 Tavily searches) in a calendar month (UTC) the app stops calling that service until the next month, so neither free allowance can be exceeded. Scans keep working using the shared library, your photo and Gemini's own value estimate.
- Set `BRAVE_MONTHLY_LIMIT` / `TAVILY_MONTHLY_LIMIT` in Vercel to change the caps (e.g. `900` for a safety margin). Tavily's own monthly reset may fall on a different day from the calendar month, so a small margin (e.g. `950`) is sensible.
- Gemini's free limits are daily (reset at midnight US Pacific) and never charge; the page shows today's count and the countdown.

## How the PIN lock works
- Every page and API route requires a signed, HTTP-only session cookie (30 days) tied to a profile. Without it you're sent to the sign-in screen.
- PINs are stored as salted scrypt hashes, never in plain text.
- 5 wrong PINs for a profile from one device locks that profile on that device for 15 minutes.
- Changing or resetting a profile's PIN signs that profile out on every other device.
- Card images are in a public bucket with random file names, so an image link works if shared, but nobody can list or browse your collection.

## Costs
- **Vercel** Hobby and **Supabase** Free tiers are enough for a personal collection (Supabase free storage is 1 GB ≈ several thousand cards).
- **Gemini**: free tier, two requests per scan (identify + price). Free-tier rate limits mean very fast back-to-back scanning may pause briefly — the app retries automatically and tells you if you need to wait a minute.
- **Searches**: 0–2 per scan (0 if the card is already in the shared library). Tavily's 1,000 free + Brave's $5 credit (~1,000) a month. "Update value" uses one search.

## Accuracy notes
- Values are **estimates for one copy** in near-mint raw condition unless a grade is entered/visible, based on prices in the top web search results for that card and converted from USD at the daily ECB rate. The app shows a low–high range, a confidence badge and the sources it used; you can override the recorded value on any card.
- Photographing the **back** as well as the front noticeably improves identification for sports and non-sport cards (that's where the year and card number live).
- If it gets the card wrong, type a hint ("1994 Fleer Ultra, gold parallel") and tap **Retry**.
- Prices are a little rougher than an AI that browses many pages itself: Gemini sees one page of search results. Tap **Update value** on your best cards now and then, and check the sources it shows.
- Pokémon cards are matched against the set's checklist from the Pokémon TCG API (TCGdex as backup) for exact images and TCGplayer prices.

## Project layout
```
app/
  login/            PIN pad
  page.tsx          Collection (grouped by set, totals, search, filters)
  add/              Scan → review → save (or save for later / bulk upload)
  pending/          Waiting list, identify one or all
  card/[id]/        Card detail, edit, re-price, change picture, delete
  api/              login, identify, images, cards, reprice, export
lib/
  ai.ts             Card identification + pricing (Gemini + Brave web results)
  images.ts         Brave web/image search, Pokémon TCG lookup
  fx.ts             USD→AUD conversion
  session.ts        Signed session cookie
  supabase.ts       Database + image storage helpers
proxy.ts            PIN gate for every request
supabase/schema.sql Database setup
```
