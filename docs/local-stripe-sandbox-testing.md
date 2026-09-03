# Local Stripe sandbox testing

This workflow uses local Supabase tables prefixed with `ba_dev`, a Stripe test-mode platform key, a Stripe sandbox connected account, and Stripe-hosted Checkout. No live charge is created.

## Start the environment

Requirements: Docker, Node.js 20+, the Supabase CLI, and the Stripe CLI.

```bash
npm install
supabase start
npm run dev:sandbox
```

Keep `dev:sandbox` running. It applies pending local migrations, forwards both platform and connected-account Stripe events to `/api/stripe/webhook`, injects the temporary webhook secret into Next.js, and serves the app at `http://localhost:3000`.

In a second terminal, verify the complete local chain:

```bash
npm run sandbox:check
```

The check fails closed unless Supabase is local, the prefix is `ba_dev`, the Stripe key is test mode, the homepage has exactly ten spots, the connected account is active, the model bucket accepts 25 MB files, and both the page and auction API respond.

Run the non-charging hosted-Checkout smoke test at any time:

```bash
npm run test:sandbox-checkout
```

It opens and expires one Checkout Session for the homepage and one for a temporary second auction, verifies their database isolation, renders a signed local Supabase logo through `next/image`, and removes the local fixtures. It does not submit card details or create a charge.

## Test 1: homepage bid through hosted Checkout

1. Open `http://localhost:3000` and select **USD** to make the expected values easiest to compare.
2. Click any **Bid** button. Confirm the dialog shows the current minimum and a deposit equal to 20% of the full bid.
3. Enter a test brand name and a non-production email. A logo is optional.
4. Click **Continue to Stripe**. The browser must leave the app for a `checkout.stripe.com` test page.
5. Pay with Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC, and any allowed test postal code.
6. Confirm Stripe returns to `/?payment=success&session_id=...`, the success notice appears, the selected spot shows the brand and bid, and **History** increments.
7. In local Supabase Studio at `http://127.0.0.1:54323`, inspect `ba_dev_laptop_bid_payments`, `ba_dev_laptop_bids`, and `ba_dev_laptop_spots`. The payment should be `accepted`, and the spot price and leader should match the page.

Also test **Cancel** on Stripe Checkout. Returning with `payment=cancelled` must leave the auction price and history unchanged.

## Test 2: create a second auction

1. Open `http://localhost:3000/sell` and complete all eight steps.
2. Use a new, unique **Address**. The address is the auction identity; an existing slug must be rejected.
3. Publish without X if local X OAuth is disabled. Copy the recovery code and verify the auction appears at `/manage`.
4. Confirm the public address loads the creator's title, story, prices, closing date, model or laptop layout, and only that auction's bid history.
5. For a full Connect onboarding test, click **Connect Stripe payouts** and complete the Stripe sandbox onboarding flow.

For a faster repeat test, reuse the already active sandbox connected account without repeating onboarding:

```bash
npm run sandbox:attach-account -- --slug=your-second-auction
```

This helper refuses hosted Supabase, `ba_prod`, and live Stripe keys. It only updates the local `ba_dev` auction.

## Test 3: bid on the second auction

1. Open `http://localhost:3000/your-second-auction`.
2. Verify the Bid button is enabled after Connect onboarding or `sandbox:attach-account`.
3. Complete Stripe-hosted Checkout with a different test brand.
4. Confirm the second auction updates while the homepage auction does not. Check that the two campaigns have different `laptop_id` values in `ba_dev_laptop_bids`.

## Test 4: outbid and refund behavior

1. Place a paid bid on one spot with Brand A.
2. Place a higher paid bid on the same spot with Brand B.
3. Confirm Brand B becomes the leader and the minimum increases by the configured increment.
4. In Stripe Sandbox, confirm Brand A's PaymentIntent is refunded, including the application fee.
5. In `ba_dev_laptop_bid_payments`, confirm Brand A is `refunded` with reason `outbid` and Brand B is `accepted`.

## Additional cases

- Bid below the minimum: rejected before Checkout starts.
- Re-submit the same browser request: one Checkout/payment record only.
- Two equal bids paid close together: one accepted; the stale payment is refunded.
- Closed auction: Bid controls are disabled and paid stale sessions are refunded.
- Connected account not ready: the form explains that seller payments are unavailable.
- Logo validation: PNG/JPG/WEBP/SVG up to 2 MB; invalid types or larger files are rejected.
- Model upload: GLB/GLTF/OBJ/STL up to 25 MB, private in Storage, restored after a page reload.
- Management: import a recovery code, close an auction, rotate/disable recovery access, and confirm another auction remains unaffected.

Run the database and ownership regression checks after schema or bidding changes:

```bash
npm run test:sandbox-regression
```
