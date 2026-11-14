# End-to-end tests

These run against the **live preview setup**: the Cloud Run API, the Supabase project and Stripe in **test mode**. They act as the "ZZ Autotest" accounts, all on `@example.com` addresses, with text messages off.

Every step is checked in three places: what the API returns, what the database holds, and what Stripe recorded.

Keys come from `harvesthub-backend/.env` and `harvesthub/app/.env`. The tests refuse to run unless the Stripe key is a test key (`sk_test_`). Running the 15-minute job on demand also needs `CRON_SECRET` in the backend `.env`.

## Run

From the project root, using the backend's Python:

```
harvesthub-backend/venv/Scripts/python harvesthub/e2e/seed.py                 # 3 farms, 10 customers, products (safe to rerun)
harvesthub-backend/venv/Scripts/python harvesthub/e2e/test_orders.py          # card, promo, refunds, cash, declined card, farmer cancel
harvesthub-backend/venv/Scripts/python harvesthub/e2e/test_delivery_pass.py   # home delivery run, Harvest Pass free month
harvesthub-backend/venv/Scripts/python harvesthub/e2e/test_pods.py           # Neighborhood Pods: join, saved cards, fee split, drop-point delivery
harvesthub-backend/venv/Scripts/python harvesthub/e2e/test_deals.py          # group deals: goal met and missed, regular-price offer
harvesthub-backend/venv/Scripts/python harvesthub/e2e/test_account.py        # saved places, ratings, deleting an account, a pod pausing
```

Each run prints PASS or FAIL per check and saves a copy in `results/`.

## Screen tests on the Android emulator

The screen tests are Maestro flows in `harvesthub/app/.maestro/`. `run_ui.py` prepares each one (for example, emptying the cart), runs it on the emulator, then checks the database and Stripe.

```
harvesthub-backend/venv/Scripts/python harvesthub/e2e/run_ui.py          # all 7, in order (about 20 minutes)
harvesthub-backend/venv/Scripts/python harvesthub/e2e/run_ui.py cancel   # only the journeys whose name contains "cancel"
```

| Flow | What it does on screen |
| --- | --- |
| `customer_promo_order.yaml` | Customer 8 opens Farm A, sees its promo, orders 2 kale and 1 jam, applies ZZTEST10 and pays $14.97 with a test card |
| `customer_signup.yaml` | A new customer signs up, using Google's address suggestions, and reaches Home |
| `farmer_signup_application.yaml` | A new farmer signs up, fills in farm details and uploads 4 documents. The runner then approves the farm, as you would in Supabase |
| `farmer_product_promo.yaml` | That farm adds a product with a photo, makes a promo code, pauses it and turns it back on |
| `farmer_mark_ready.yaml` | The runner places a paid order; the farmer sees it, with earnings at 10%, and marks it ready |
| `customer_pickup_rate.yaml` | Customer 3 marks that order received and rates the farm 4 stars |
| `customer_cancel.yaml` | The runner places a paid order; customer 3 cancels it and sees it refunded |

Each full run signs up a new customer and a new farm, named with the date and time ("ZZ Autotest UI Farm 11131900"). Farms from earlier runs are suspended, so customers don't see them pile up. The sample photo they upload is `autotest-photo.png`; the runner copies it to the phone's Downloads.

**What it needs:**
- The emulator running with the preview app installed. To install it: `eas build -p android --profile preview`, then `adb install` the APK.
- Maestro in `%USERPROFILE%\.maestro`.
- Android Studio's Java, or `JAVA_HOME` set.

**Results:** screenshots of every step, including where a flow failed, go to `results/maestro/`.

**One limitation:** Stripe's Pay button can't be seen by automation tools, so the flows tap where it sits on screen.

## Finding the test data in Supabase

- **Farms:** `farmer_profiles.farm_name` starts with `ZZ Autotest`.
- **Products:** `products.name` starts with `ZZ `.
- **Accounts:** the email in `auth.users` starts with `autotest-` and ends with `@example.com`.
- **The password for every test account:** `Autotest-2026!` (test only).

## What the tests change

- **Data they create:** they place real Stripe **test-mode** charges and refunds, and leave their orders in the database.
- **Deadlines:** to make things happen now, they move dates on their own test rows: a delivery run, pod orders' delivery window, a group deal's opening and deadline. Then they run the 15-minute job on demand.
- **What they never do:** they don't run the Friday payout job by hand, because that would also pay out real testers' earnings early.

Results are written up in the "HarvestHub Automated Test Results" doc: https://claude.ai/artifact/MXEKUsaNdcVeXSV6AjvePF
