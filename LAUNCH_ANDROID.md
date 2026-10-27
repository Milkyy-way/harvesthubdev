# Launching HarvestHub on Google Play

This is the step-by-step runbook from code to Play Store. The code side is done (see **What's already in the code**). Everything below is something you do in a dashboard or terminal.

Work top to bottom. Steps 1–2 take weeks of waiting, so start them first and do the rest while you wait.

---

## What's already in the code

| Requirement | Where |
|---|---|
| App identity: **HarvestHub**, package `com.harvesthubmarket.app`, links `harvesthub://` | `harvesthub/app/app.json` |
| Separate dev app (**HarvestHub Dev**, `com.harvesthubmarket.app.dev`) that installs next to the store app | `harvesthub/app/app.config.ts`, `npm start` |
| Real icon set, adaptive icon, splash (from your logo) | `harvesthub/app/assets/` |
| Play Store icon (512×512) and feature graphic (1024×500) | `harvesthub/store-assets/` |
| Unused Android permissions blocked (storage, media, microphone, overlay) | `app.json` → `android.blockedPermissions` |
| Production build profile (`.aab`), version numbers increase automatically, submit config | `harvesthub/app/eas.json` |
| Production builds refuse a non-https API address | `app.config.ts` |
| **In-app account deletion** (customers: Settings → Delete account; farmers: Account → Delete account) | `components/screens/DeleteAccountScreen.tsx`, `DELETE /api/v1/account` |
| Database cleanup on deletion: personal data erased, financial records kept anonymized | `supabase/migrations/0027_account_deletion.sql` |
| **Public pages:** `/privacy`, `/terms`, `/delete-account` | `harvesthub-backend/app/legal/` (served by the API) |
| Legal screen links to those pages | `components/screens/LegalScreen.tsx` |
| **Email verification with a 6-digit code** at sign-up | `app/(auth)/verify-email.tsx` |
| Backend production settings: docs hidden, CORS configurable | `harvesthub-backend/app/main.py`, `.env.example` |
| Backend container | `harvesthub-backend/Dockerfile` |
| One command to set up a new database (skips the fake sample farms) | `harvesthub/supabase/apply-migrations.mjs` |
| Harvest Pass free for every new customer's first 30 days; no referral rewards ("Invite friends" is a plain share) | `app/membership/`, `0029_harvest_pass_free_period.sql` |
| **Push, email and text notifications** for orders, Harvest Pass, approvals and payouts, with a Notifications settings screen | `harvesthub-backend/app/notifications/`, `lib/pushNotifications.ts`, `0030_notifications.sql` |
| Address suggestions while typing, precise geocoding, users can't write their own coordinates | `components/AddressSearchField.tsx`, `app/core/geocoding.py`, `0031_precise_locations.sql` |
| **Farm delivery:** farms set fee/distance/windows, customers book a window, farmers run deliveries (route order, delivered + photo, couldn't deliver), customers follow progress | `app/delivery/`, `app/(farmer)/deliveries.tsx`, `0032_farm_delivery.sql` |

> ⚠️ **The privacy policy and terms are drafts** written to match what the app actually does. Have a lawyer review `harvesthub-backend/app/legal/pages/privacy.html` and `terms.html` before launch. Set `COMPANY_NAME` to your LLC's exact name once it exists.

---

## 1. Business setup (start now; this is the slowest part)

- [ ] Form the LLC (your state's business filing site).
- [ ] Get an EIN: irs.gov, free, same day online.
- [ ] Open a business bank account.
- [ ] Request a **D-U-N-S number** from Dun & Bradstreet. It's free and can take up to 30 days; don't pay for "expedited". Needed for an **organization** Play account.
- [ ] Make sure `support@harvesthubmarket.com` is a real inbox someone reads. The app, the legal pages and Google Play all point to it.
- [ ] Ask Stripe directly whether paying farmers by manual bank transfer from your account is OK, or whether they require Stripe Connect. Ask before going live.

## 2. Google Play developer account

- [ ] Go to https://play.google.com/console and pay **$25**.
- [ ] Choose **Organization** once you have the LLC and D-U-N-S. You'll need the D-U-N-S, a website on your domain, and an organization phone and email, which Google verifies.
  - A **Personal** account is faster to open, but Google then requires a **closed test with at least 12 testers for 14 days in a row** before you can publish. Switching later means a new account plus an app transfer, so pick once.
- [ ] Complete identity verification, using exact legal names and documents.

---

## 3. Email sending (Resend)

Both the sign-up and password-reset codes (sent by Supabase) and the farmer approval emails need a real sender. Supabase's built-in mailer only sends a couple of emails an hour, and only to your own team.

- [ ] Create an account at resend.com, then **add the domain** `harvesthubmarket.com`.
- [ ] Add the DNS records Resend shows you (SPF, DKIM, and ideally a DMARC record) at your domain registrar. Wait until Resend says **Verified**.
- [ ] Create an **API key** (it starts with `re_`). You'll use it twice below: for Supabase's SMTP, and as the backend's `RESEND_API_KEY` (order and account emails, step 5).
- [ ] The free plan sends 3,000 emails a month but only **100 a day**. Move to Pro ($20/month) once you get close; Resend → Usage shows where you are.

## 3b. Text messages (Telnyx)

Texts are optional and opt-in: customers and farmers turn them on in Settings → Notifications. Until the keys below are set, the app simply doesn't offer texts.

- [ ] Create an account at telnyx.com and complete account verification.
- [ ] US carriers only deliver business texts from **registered** numbers. Either:
  - **10DLC (a local number):** register a Brand (needs your **EIN**, about $4 one-time) and a Campaign ("Customer care / account notifications", about $15 vetting plus ~$2–10/month), then buy a local number (~$1/month) and attach it; or
  - **Toll-free:** buy a toll-free number and submit Toll-Free Verification (free, but since 2026 it also requires your **EIN**).
  Either way this waits on the LLC and EIN from step 1. Approval takes a few days.
  - For the registration form: messages are order updates (ready for pickup, cancelled, new order for farms); users opt in by turning texts on in the app, which shows the number, "Message and data rates may apply" and "Reply STOP to stop"; every text ends with "Reply STOP to opt out". Point them to your privacy policy URL.
- [ ] Create a **Messaging Profile** and keep its default **STOP/HELP handling on**: Telnyx then refuses to text anyone who replied STOP.
- [ ] Create an **API key**. Backend variables (step 5): `TELNYX_API_KEY`, and `TELNYX_FROM_NUMBER` in `+1XXXXXXXXXX` form.
- [ ] Cost: about $0.004 per text plus ~$0.003–0.005 carrier fee. At launch volume that's a few dollars a month on top of the fixed fees.

## 3c. Address suggestions and geocoding (Google Maps)

One key, used **only by the backend** — the app asks the backend for suggestions, so nothing goes into the app. Do this in the same Google Cloud project as Firebase and Google sign-in.

- [ ] Google Cloud console → **Billing**: the project needs a billing account (a card), even though you'll stay inside the free amounts at launch. Add a **budget alert** (Billing → Budgets & alerts), e.g. $10.
- [ ] **APIs & Services → Library:** enable **Places API (New)** and **Geocoding API**.
- [ ] **APIs & Services → Credentials → Create credentials → API key.** Then edit the key:
  - **API restrictions → Restrict key** → tick **Places API (New)** and **Geocoding API** only.
  - Application restrictions: **None** (it lives on the server, never in the app).
  - Name it e.g. "HarvestHub server".
- [ ] Put it in the backend as `GOOGLE_MAPS_API_KEY` — your local `harvesthub-backend/.env` for development, and the host's environment for production (step 5). The same key can serve both.
- [ ] Optional safety cap: **APIs & Services → Places API (New) → Quotas**, lower the per-day request limit (e.g. 2,000). The backend already limits each phone to 60 lookups a minute.
- Free every month: 10,000 address lookups (Place Details), 10,000 geocodes, and the suggestions shown while typing are free when the user picks one. At launch size you won't pay anything.
- Google's terms only allow keeping its coordinates for 30 days, so the backend re-geocodes every home and farm monthly by itself (the scheduled job, step 5). Nothing for you to do.
- Without the key, address fields are plain text boxes and the backend falls back to the free Census/ZIP lookups (less exact).

## 3d. Push notifications (Firebase + Expo)

Android push goes through Firebase Cloud Messaging; Expo's push service (free) talks to it for us.

- [ ] Firebase console (console.firebase.google.com) → **Add project**, using your existing Google Cloud project.
- [ ] Add **two Android apps**: `com.harvesthubmarket.app` and `com.harvesthubmarket.app.dev`. Download **google-services.json** (it covers both) and put it at `harvesthub/app/google-services.json`. It isn't secret; commit it.
- [ ] Project settings → **Service accounts** → **Generate new private key** (a JSON file — this one IS secret; keep it out of the repo).
- [ ] Give it to Expo: `npx eas-cli credentials -p android` → production → **Google Service Account** → **Manage your Google Service Account Key for Push Notifications (FCM V1)** → upload the JSON. Repeat for the development profile.
- [ ] iOS later: EAS sets up the Apple push key for you on the first iOS build (needs the Apple Developer account).

## 4. Supabase production project

Create a **new** project for production, separate from the one you develop on, so test data never mixes with real customers.

- [ ] Supabase → New project.
  - Region: **East US (N. Virginia)**, closest to DC/MD/VA.
  - Plan: **Pro** ($25/month), for daily backups and no pausing.
  - Save the database password somewhere safe.
- [ ] **Create the tables.** From the `harvesthub` folder, run:
  ```
  node supabase/apply-migrations.mjs "<connection string>"
  ```
  - Get the connection string from Project Settings → Database → Connection string → **Session pooler**, with your password filled in.
  - The script uses `psql` from your PostgreSQL install, applies all migrations in order, and **skips the sample farms**. It's safe to run again.
- [ ] Also bring your **development** project up to date (it needs the new `0032` — farm delivery; it also creates the private `delivery-photos` storage bucket):
  ```
  node supabase/apply-migrations.mjs "<dev connection string>" --from 0032
  ```
  If you never applied 0029–0031 there, use `--from 0029` (every migration is safe to run again).
- [ ] Check the extensions (Database → Extensions): **pg_cron** should be on (the migration turns it on). pg_net isn't needed any more (farmer emails now come from the backend).

### Authentication settings (production project)

- [ ] **Emails → SMTP:** enable custom SMTP.
  - Host `smtp.resend.com`, port `465`.
  - Username `resend`, password = your Resend API key.
  - Sender `no-reply@harvesthubmarket.com`, name `HarvestHub`.
- [ ] **Rate limits:** after SMTP is on, raise "emails per hour" (for example to 100).
- [ ] **Providers → Email:** turn **Confirm email ON**. Any "Email OTP length" from 6 to 10 digits works with the app.
- [ ] **Email Templates → Confirm signup:**
  - Subject: *Your HarvestHub verification code*
  - Body:
  ```html
  <h2>Welcome to HarvestHub</h2>
  <p>Enter this code in the HarvestHub app to confirm your email:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
  <p>The code expires in 1 hour. If you didn't sign up for HarvestHub, you can ignore this email.</p>
  ```
- [ ] **Email Templates → Reset Password:** use the same code template as the dev project:
  - Subject: *Your HarvestHub password reset code*
  - Body:
  ```html
  <h2>Reset your HarvestHub password</h2>
  <p>Enter this code in the HarvestHub app to choose a new password:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
  <p>The code expires in 1 hour. If you didn't ask to reset your password, you can ignore this email.</p>
  ```
- [ ] **URL Configuration:**
  - Site URL: `https://harvesthubmarket.com`.
  - Redirect URLs: add `harvesthub://auth-callback`.
- [ ] **Development project only:** add the redirect URL `harvesthub-dev://auth-callback`. The dev app now uses this link for Google sign-in.

### Google sign-in (production project)

- [ ] In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type **Web application**.
  - Authorized redirect URI: `https://<your-prod-project-ref>.supabase.co/auth/v1/callback`.
- [ ] Copy the client ID and secret into Supabase → Authentication → Providers → Google.
- [ ] Set up the **OAuth consent screen**:
  - App name **HarvestHub**, support email.
  - Privacy policy URL `https://api.harvesthubmarket.com/privacy`.
  - Authorized domain `harvesthubmarket.com`.
  - Then **Publish app** (move it from "Testing" to "In production"). While it's in Testing, only listed test users can sign in.
  - Only the basic email/profile scopes are used, so no Google review is needed. Uploading a logo there does start a brand review.

### Farmer approval and rejection emails

Nothing to do: the backend now sends these (email and push) through its scheduled job, step 5. **Leave the old database switch off** (`app_config.farmer_review_emails_enabled = 'false'`, from 0023) in both projects, or farmers get every decision twice.

### Your admin access

You approve farmers in Studio exactly as you do in development: Table Editor → `farmer_verification` → set `status`.

---

## 5. Deploy the backend (FastAPI)

Any host that runs a Dockerfile works. **Render** is the simplest:

- [ ] Render → New → **Web Service** → connect the GitHub repo.
  - Root directory `harvesthub-backend`. Runtime **Docker**.
  - Region **Virginia (US East)**. Plan **Starter** (about $7/month; the free plan sleeps).
  - Health check path `/health`.
- [ ] Environment variables (Render → Environment). See `harvesthub-backend/.env.example`:

  | Name | Value |
  |---|---|
  | `DATABASE_URL` | Production Supabase **Session pooler** connection string |
  | `SUPABASE_URL` | `https://<prod-ref>.supabase.co` |
  | `SUPABASE_SERVICE_ROLE_KEY` | Production project → API keys → **secret / service_role** key. **Server only.** Needed for account deletion. |
  | `STRIPE_SECRET_KEY` | `sk_live_...` (step 6) |
  | `STRIPE_WEBHOOK_SECRET` | `whsec_...` (step 6) |
  | `ENVIRONMENT` | `production` |
  | `CORS_ORIGINS` | *(empty)* |
  | `COMPANY_NAME` | Your LLC's exact name, e.g. `HarvestHub LLC` |
  | `SUPPORT_EMAIL` | `support@harvesthubmarket.com` |
  | `LEGAL_EFFECTIVE_DATE` | The date your reviewed policy takes effect |
  | `RESEND_API_KEY` | Your Resend key (step 3). Order and account emails. |
  | `EMAIL_FROM` | `HarvestHub <no-reply@harvesthubmarket.com>` |
  | `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` | Step 3b, once your number is registered. Leave unset until then. |
  | `GOOGLE_MAPS_API_KEY` | Step 3c |
  | `CRON_SECRET` | Any long random string (a password generator's 40 characters). Used by the scheduled job below. |

- [ ] **Scheduled job** (reminders, farmer approval/rejection notices, payout notices, and the monthly location refresh Google's terms require). Google Cloud → **Cloud Scheduler** → Create job (3 jobs a month are free):
  - Frequency `*/15 * * * *`, time zone America/New_York.
  - Target **HTTP**, method **POST**, URL `https://api.harvesthubmarket.com/api/v1/internal/jobs/run`.
  - Header `X-Cron-Secret` = the same value as `CRON_SECRET`.
  - "Force run" it once: the response lists what it sent, e.g. `{"free_period_ending": 0, ...}`. A 404 means the secret doesn't match.
- [ ] Custom domain: add `api.harvesthubmarket.com` in Render, then create the **CNAME** record it gives you at your registrar. Render issues the HTTPS certificate.
- [ ] Check these open in a browser:
  - `https://api.harvesthubmarket.com/health` → `{"status":"ok"}`
  - `/privacy`, `/terms`, `/delete-account` → the pages
  - `/docs` → **404**, which is correct in production

## 6. Stripe live mode

- [ ] Stripe → **Activate account**: business details, EIN, and the business bank account.
- [ ] Developers → API keys (live): copy `pk_live_...` (for the app) and `sk_live_...` (for the backend).
- [ ] Developers → Webhooks → **Add endpoint**:
  - URL `https://api.harvesthubmarket.com/api/v1/webhooks/stripe`
  - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and for Harvest Pass `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
  - Copy the signing secret (`whsec_...`) into the backend's `STRIPE_WEBHOOK_SECRET`.
- [ ] Keep test keys in your development `.env` files. Live keys go **only** on Render and in EAS.

---

## 7. Build the app (EAS)

All commands run in `harvesthub/app`.

- [ ] Log in: `npx eas-cli login`
- [ ] **Production environment variables.** These are read by EAS builds; your local `.env` is not used for them:
  ```
  npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<prod-ref>.supabase.co --visibility plaintext
  npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <prod anon/publishable key> --visibility plaintext
  npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.harvesthubmarket.com/api/v1 --visibility plaintext
  npx eas-cli env:create --environment production --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value pk_live_... --visibility plaintext
  ```
  Do the same for `--environment preview` if you build preview APKs. Never put the service-role key or `sk_` keys here: everything in the app can be read by anyone.
- [ ] **Rebuild your dev app** (push notifications, and the camera for delivery photos, added native code the old dev build doesn't have). Put `google-services.json` in place first (step 3d). It installs as "HarvestHub Dev":
  ```
  npx eas-cli build --profile development --platform android
  ```
  Uninstall the old dev app (named "app"). From now on, start the dev server with **`npm start`**, not `npx expo start`. `npm start` tells the dev server it's the dev app, which Google sign-in in development depends on.
- [ ] **Production build:**
  ```
  npx eas-cli build --profile production --platform android
  ```
  When asked, let EAS **generate a new keystore**. The result is an `.aab` file.
- [ ] **Back up the signing key:** `npx eas-cli credentials -p android` → Android → production → **Download keystore**. Store it and its passwords somewhere safe, outside the repo.

---

## 8. Set up the app in Play Console

### Create the app
- [ ] **Create app**: name **HarvestHub**, default language English (United States), **App**, **Free**. Accept the declarations.

### App content (Policy → App content)
- [ ] **Privacy policy:** `https://api.harvesthubmarket.com/privacy`
- [ ] **App access:** "All or some functionality is restricted", then add instructions (see **Reviewer accounts** below).
- [ ] **Ads:** No.
- [ ] **Content rating:** start the questionnaire.
  - Category: "All other app types".
  - Answer **No** to violence, sexual content, profanity, drugs, and gambling.
  - Users can leave ratings and comments that the farm sees. Answer the user-interaction questions with that in mind.
  - It doesn't share users' location and has no digital purchases. Purchases are of physical goods.
- [ ] **Target audience:** 18 and over only. The app is not designed for children.
- [ ] **News app:** No. **Health apps:** None. **Government app:** No.
- [ ] **Financial features:** HarvestHub sells physical goods with Stripe checkout. That isn't banking, lending, a wallet, or money transfer, so it isn't a financial feature in Google's sense. Read the list and answer accurately.
- [ ] **Data safety.** Answer exactly as below; it matches the app and the privacy policy:

  **Overview questions**
  - Does your app collect or share any of the required user data types? **Yes**
  - Is all user data encrypted in transit? **Yes**
  - Account creation methods: **Username and password**, **OAuth (Google)**
  - Delete account URL: `https://api.harvesthubmarket.com/delete-account`
  - Can users request that some data be deleted without deleting their account? Users can edit or clear their profile and preferences, but there's no partial-delete request flow, so answer **No**.

  **Data types** (Collected = yes for all rows below; none are processed ephemerally)

  | Category → type | Required? | Purposes | Shared? |
  |---|---|---|---|
  | Personal info → **Name** | Required | App functionality, Account management | **Yes**, with the farm you order from (App functionality)* |
  | Personal info → **Email address** | Required | Account management, App functionality (verification and reset codes) | No |
  | Personal info → **Phone number** | Required | App functionality (and order texts, if the user turns them on) | **Yes**, with the farm you order from* |
  | Personal info → **Address** | Required | App functionality (nearby farms; farm pickup address; address suggestions; delivery) | **Yes**, for delivery orders, with the farm delivering it* |
  | Device or other IDs → **Device or other IDs** (push notification token) | Optional (only if notifications are allowed) | App functionality | No |
  | Personal info → **Other info** (dietary preferences, farmer license numbers, references) | Optional | App functionality | No |
  | Financial info → **User payment info** | Optional (cash on pickup exists) | App functionality (card payments via Stripe) | No (Stripe is a service provider) |
  | Financial info → **Purchase history** | Required | App functionality | No |
  | Financial info → **Other financial info** (farmer tax ID, earnings) | Optional | App functionality, Fraud prevention / compliance | No |
  | Photos and videos → **Photos** (farm and product photos; farmers' proof-of-delivery photos, kept 30 days) | Optional | App functionality | **Yes**, a delivery photo with the customer it was delivered to |
  | Files and docs → **Files and docs** (farmer verification documents) | Optional | App functionality, Fraud prevention / compliance | No |
  | App activity → **Other user-generated content** (ratings, comments) | Optional | App functionality | No |

  \* Google doesn't count data as "shared" when the user starts the action and expects it, like placing an order after reading the checkout notice. You *may* mark Name and Phone as not shared. Declaring them is the cautious choice, and it's what the privacy policy says.

### Store listing (Grow → Store presence → Main store listing)
- [ ] **App name** (≤30 characters): `HarvestHub: Local Farm Market`
- [ ] **Short description** (≤80): `Order fresh produce, eggs & more from local farms, then pick up at the farm.`
- [ ] **Full description:**
  ```
  HarvestHub connects you with independent farms near you. See what's in season, order ahead, and pick up fresh food straight from the people who grow it.

  FOR CUSTOMERS
  • Discover farms near you, with photos, stories and ratings
  • Shop vegetables, fruit, eggs, dairy, meat, herbs, flowers and honey
  • Browse this week's harvest picks and use farm promo codes
  • Pay securely by card, or choose cash on pickup
  • Follow each order until it's ready for pickup
  • See what you spend by category on your dashboard
  • Rate farms after you pick up

  FOR FARMERS
  • Apply in the app. HarvestHub reviews every farm before it can sell
  • List products with prices, stock and photos
  • Get each customer's name and phone number to arrange pickup
  • Mark orders ready, and track weekly earnings and payouts

  Pickup only for now. HarvestHub is a marketplace: each farm is an independent business responsible for the products it sells.
  ```
- [ ] **App icon:** `harvesthub/store-assets/play-icon-512.png`
- [ ] **Feature graphic:** `harvesthub/store-assets/feature-graphic-1024x500.png`. A designed version with a tagline would look better, but this one meets the requirements.
- [ ] **Phone screenshots:** at least 4, portrait (for example 1080×1920), taken from the internal-testing build:
  - Home
  - a farm page
  - cart/checkout
  - order tracking
  - the dashboard donut
  - optionally, the farmer Orders tab
- [ ] **Category:** Shopping. **Contact:** support email and website.

### Reviewer accounts
Google's reviewers and pre-launch robots must get past the login screen:
- [ ] Sign up two accounts **in the production app** before submitting, using inboxes you control so you can enter the verification codes:
  - `review-customer@harvesthubmarket.com`: give it an address near your demo farm.
  - `review-farmer@harvesthubmarket.com`: submit the application, **approve it in Studio**, and add 2–3 products with photos.
- [ ] Name the farm so it's obviously a test, for example "HarvestHub Test Farm". Between reviews, set its products hidden so real customers don't see them.
- [ ] Paste this into **App access** (fill in the passwords):
  ```
  Log in with email + password (Google sign-in is optional).
  Customer: review-customer@harvesthubmarket.com / <password>
    Home lists HarvestHub Test Farm. Add an item, then check out with "Cash on pickup" (no card needed).
  Farmer: review-farmer@harvesthubmarket.com / <password>
    An approved farm. The Orders tab shows customer orders; Products lets you add or edit items.
  Account deletion: Account → Settings → Delete account (customer), Account → Delete account (farmer).
  ```
- [ ] Keep the backend running during review. A login that fails means a rejection.

---

## 9. Upload, test, release

- [ ] **First upload by hand.** Google requires this before EAS can upload. Go to Testing → **Internal testing** → Create release, upload the `.aab`, add yourself as a tester, and roll out.
  - Accept **Play App Signing** when asked. Google keeps the final key; your keystore becomes the "upload key".
- [ ] Install from the internal-testing link and run the **launch test** below.
- [ ] **Closed testing** with real farmers and friends. On a personal account you need at least 12 testers for 14 consecutive days. Recruit 15–20, because if the count drops below 12 the 14 days restart.
- [ ] Read the **pre-launch report** in Play Console (crashes, accessibility, sign-in problems).
- [ ] **Production:** apply for production access (personal accounts), then create a production release with a **staged rollout** (for example 20%, then 100%). The first review usually takes a few days.

### Later uploads with one command
- [ ] Google Cloud → IAM → **Service accounts** → create one, then create a **JSON key**.
- [ ] Play Console → **Users and permissions** → invite the service account's email with release permissions for HarvestHub.
- [ ] Save the key as `harvesthub/app/google-play-service-account.json` (it's git-ignored).
- [ ] From then on: `npx eas-cli build -p android --profile production`, then `npx eas-cli submit -p android --latest`. This uploads a draft to Internal testing; promote it in Play Console.

### Launch test (on the internal-testing build)
- [ ] Sign up as a customer with email → code arrives → enter it → land on Home.
- [ ] Sign up with Google.
- [ ] Forgot password → code → new password works.
- [ ] Order with a **real card**, then cancel it → refund shows in Stripe.
- [ ] Cash on pickup order → farmer marks ready → customer marks picked up.
- [ ] Farmer sign-up → code → application with documents → approve in Studio → approval email arrives → Products unlock.
- [ ] Legal screen opens all three pages.
- [ ] Delete a test customer (Settings → Delete account) → logged out, can't log back in.
- [ ] Delete a test farmer → its folders are gone from Storage (`farmer-verification-docs`, `farmer-photos`).

---

## Keep in mind
- **The package name `com.harvesthubmarket.app` is permanent** after the first upload.
- **Never use Google Play Billing for produce.** Physical goods must go through Stripe, as they do now.
- Every new release needs a higher version code. EAS increases it automatically (`autoIncrement`).
- Google raises the minimum Android target every August. The app targets Android 16 (API 36), which meets the current requirement; next year's will likely be API 37 (a routine Expo SDK upgrade).
- If someone emails asking to delete their account, delete the user in Supabase → Authentication → Users. The database cleanup runs automatically. Then delete their folder in the two Storage buckets.
