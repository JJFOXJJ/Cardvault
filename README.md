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

4. **Deploy**. Open the URL, enter your PIN, and tap **+ Add card**.
5. On your phone: Share → **Add to Home Screen** for an app-like icon.

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
- Everyone shares the same Gemini and Brave free allowance.
- `APP_PIN` is only used for that first setup.

## Usage meter (shared free allowance)
Run `supabase/migrations/004_usage.sql` once. The app then counts every Brave search and Gemini request, per profile.
- Home, Add card and Profiles show **~scans left this month** with a reset countdown; tap it for the breakdown by profile.
- **Safety stop:** at 1,000 Brave searches in a calendar month (UTC) the app stops calling Brave until the next month, so the free $5 credit can't be exceeded. Scans keep working using your photo and Gemini's own value estimate.
- Set `BRAVE_MONTHLY_LIMIT` in Vercel to change the cap (e.g. `900` for a safety margin).
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
- **Brave**: two searches per scan, covered by the $5 free monthly credit up to ~500 scans/month. "Update value" uses one search.

## Accuracy notes
- Values are **estimates for one copy** in near-mint raw condition unless a grade is entered/visible, based on prices in the top web search results for that card and converted from USD at the daily ECB rate. The app shows a low–high range, a confidence badge and the sources it used; you can override the recorded value on any card.
- Photographing the **back** as well as the front noticeably improves identification for sports and non-sport cards (that's where the year and card number live).
- If it gets the card wrong, type a hint ("1994 Fleer Ultra, gold parallel") and tap **Retry**.
- Prices are a little rougher than an AI that browses many pages itself: Gemini sees one page of search results. Tap **Update value** on your best cards now and then, and check the sources it shows.
- Pokémon cards are matched against the official Pokémon TCG database for exact images and TCGplayer prices.

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
