# Card Vault

A private, PIN-locked trading card catalogue. Photograph a card and the app:

1. **Identifies it** with Google Gemini (free tier) — player/character, year, maker, set, number, parallel, grade.
2. **Values it** from a web search for recent sales of that card (eBay, 130point, PSA, PriceCharting…), shown in **AUD**.
3. **Finds a clean picture** of the card online (Brave image search, or the official Pokémon TCG database for Pokémon) and stores that instead of your photo. Your photo is kept too, for condition reference.
4. **Files it into its collection/set**, with totals per set and for the whole vault.

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
| `APP_PIN` | Your PIN — use 6 or more digits |
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

## How the PIN lock works
- Every page and API route requires a signed, HTTP-only session cookie (30 days). Without it you're sent to the PIN pad.
- 5 wrong PINs from one IP locks that IP out for 15 minutes.
- **Changing `APP_PIN` in Vercel (then redeploying) signs out every device.**
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
  add/              Scan → review → save
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
