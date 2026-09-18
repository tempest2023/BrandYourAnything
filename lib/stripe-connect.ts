import "server-only";
import type Stripe from "stripe";
import type { AuctionOwnerCredential } from "@/lib/publishing-auth";
import { auctionUrl, auctionPath } from "@/lib/site";
import { getStripe, getStripeMerchantAccountState } from "@/lib/stripe";
import { stripeEnvironment } from "@/lib/stripe-bid-repository";
import { ownedStripeAccount, StripeConnectError, type OwnedStripeAccount } from "@/lib/stripe-connect-repository";
import { DEFAULT_CONNECT_COUNTRY, normalizeConnectCountry } from "@/lib/stripe-countries";

// Stripe only needs the country up front; the hosted onboarding collects the
// rest. A deployment can point the default at its own market.
function defaultConnectCountry() {
  return normalizeConnectCountry(process.env.STRIPE_CONNECT_DEFAULT_COUNTRY) ?? DEFAULT_CONNECT_COUNTRY;
}

function accountParameters(auction: OwnedStripeAccount, owner: AuctionOwnerCredential, country: string): Stripe.V2.Core.AccountCreateParams {
  const publicUrl = new URL(auctionUrl(auction.slug));
  const businessUrl = publicUrl.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)
    ? publicUrl.toString() : undefined;
  return {
    contact_email: owner.ownerEmail,
    // Full Dashboard is required when Stripe collects fees and bears merchant
    // negative balances. Express would transfer both responsibilities to us.
    dashboard: "full",
    display_name: auction.title,
    identity: { country },
    defaults: {
      // Stripe requires a public business website, unlike its test return URLs.
      // Local creators can provide business details during hosted onboarding.
      profile: { ...(businessUrl ? { business_url: businessUrl } : {}), product_description: "Auctioned brand placement on a creator-owned object." },
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
    },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    include: ["configuration.merchant", "requirements"],
    // Preserve metadata so pre-migration orphaned accounts remain discoverable.
    metadata: { brand_anything_auction_id: auction.id, brand_anything_slug: auction.slug },
  };
}

function matchesAuction(account: Stripe.V2.Core.Account, auction: OwnedStripeAccount) {
  // Ownership, not Stripe mode: the same auction may legitimately be onboarded
  // from a sandbox account while the deployment is the production domain.
  return account.metadata?.brand_anything_auction_id === auction.id
    && account.metadata?.brand_anything_slug === auction.slug;
}

async function recoverAccount(auction: OwnedStripeAccount) {
  const matches: Stripe.V2.Core.Account[] = [];
  // Legacy creates had no durable reservation. Search open AND closed accounts
  // before creating; a closed original account must not be replaced silently.
  for (const closed of [false, true]) {
    let count = 0;
    for await (const account of getStripe().v2.core.accounts.list({ closed, limit: 100 })) {
      if (matchesAuction(account, auction)) matches.push(account);
      if (++count >= 1000) throw new StripeConnectError(409, "The previous Stripe setup needs operator reconciliation before retrying.");
    }
  }
  if (matches.length > 1) throw new StripeConnectError(409, "Multiple Stripe accounts match this auction. Contact support before continuing.");
  return matches[0] ?? null;
}

async function syncAccount(auction: OwnedStripeAccount, owner: AuctionOwnerCredential) {
  const account = await getStripeMerchantAccountState(auction.accountId!);
  await ownedStripeAccount(auction.slug, owner, "status", {
    accountId: account.id,
    chargesEnabled: !account.closed && account.chargesEnabled,
    payoutsEnabled: !account.closed && account.payoutsEnabled,
  });
  return { connected: true, closed: account.closed,
    ready: !account.closed && account.chargesEnabled && account.payoutsEnabled,
    chargesEnabled: !account.closed && account.chargesEnabled,
    payoutsEnabled: !account.closed && account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted };
}

export async function readOwnedStripeStatus(slug: string, owner: AuctionOwnerCredential) {
  const auction = await ownedStripeAccount(slug, owner, "check");
  return auction.accountId ? syncAccount(auction, owner) : { connected: false, ready: false };
}

export async function startOwnedStripeOnboarding(slug: string, owner: AuctionOwnerCredential, origin: string, country?: string) {
  let auction = await ownedStripeAccount(slug, owner, "check");
  if (!auction.accountId) {
    if (auction.legacy && !auction.parameters) {
      const previous = await recoverAccount(auction);
      if (previous) auction = await ownedStripeAccount(slug, owner, "bind", { accountId: previous.id });
    }
    if (!auction.accountId) {
      const requested = country ?? defaultConnectCountry();
      auction = await ownedStripeAccount(slug, owner, "reserve", {
        parameters: auction.parameters ?? accountParameters(auction, owner, requested),
      });
      if (!auction.accountId) {
        if (!auction.parameters || !auction.requestedAt) throw new Error("Connect reservation is missing its request identity.");
        if (auction.parameters.identity?.country !== requested) throw new StripeConnectError(409, "The country for this Stripe setup is already saved. Continue with that country or contact support.");
        const old = Date.now() - Date.parse(auction.requestedAt) >= 29 * 86_400_000;
        const account = old ? await recoverAccount(auction) : await getStripe().v2.core.accounts.create(auction.parameters, {
          idempotencyKey: `ba-${stripeEnvironment()}-connect-v2-${auction.id}`,
        });
        if (!account) throw new StripeConnectError(409, "This Stripe setup attempt is too old to retry automatically. Contact support to reconcile it.");
        if (!matchesAuction(account, auction)) throw new Error("Stripe account does not match its reserved auction.");
        auction = await ownedStripeAccount(slug, owner, "bind", { accountId: account.id });
      }
    }
  }
  const status = await syncAccount(auction, owner);
  if (status.closed) throw new StripeConnectError(409, "The connected Stripe account is closed. Contact support; no replacement account was created.");
  if (status.ready) return { ...status, returnUrl: new URL(auctionPath(auction.slug), origin).toString() };

  const returnUrl = new URL("/manage", origin);
  returnUrl.searchParams.set("stripe", "return"); returnUrl.searchParams.set("slug", auction.slug);
  const refreshUrl = new URL(returnUrl); refreshUrl.searchParams.set("stripe", "refresh");
  const link = await getStripe().v2.core.accountLinks.create({
    account: auction.accountId!,
    use_case: { type: "account_onboarding", account_onboarding: {
      configurations: ["merchant"], refresh_url: refreshUrl.toString(), return_url: returnUrl.toString(),
      collection_options: { fields: "eventually_due", future_requirements: "include" },
    } },
  });
  // Recheck after the external call: don't disclose an onboarding link to a
  // request whose recovery credential was revoked while Stripe was responding.
  await ownedStripeAccount(slug, owner, "check", { accountId: auction.accountId! });
  return { ...status, onboardingUrl: link.url };
}
