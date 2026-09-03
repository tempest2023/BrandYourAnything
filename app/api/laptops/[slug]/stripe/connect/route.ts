import Stripe from "stripe";

import { getOwnedStripeCampaign, setStripeCampaignAccount, stripeEnvironment } from "@/lib/stripe-bid-repository";
import { laptopUrl, publicLaptopUrl, SITE_URL } from "@/lib/site";
import { getStripe, getStripeMerchantAccountState, isStripeConfigured } from "@/lib/stripe";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { getPublishingOwner, XAuthenticationError } from "@/lib/x-auth";

export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: "Stripe Connect is not configured for this deployment." },
    { status: 503 },
  );
}

async function campaignForOwner(request: Request, slug: string) {
  const owner = await getPublishingOwner(request);
  return getOwnedStripeCampaign(slug, owner);
}

async function syncAccount(laptopId: string, accountId: string) {
  const account = await getStripeMerchantAccountState(accountId);
  if (account.closed) throw new Error("The connected Stripe account was closed.");
  await setStripeCampaignAccount(
    laptopId,
    account.id,
    account.chargesEnabled,
    account.payoutsEnabled,
  );
  return account;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) return unavailable();
  try {
    const { slug } = await context.params;
    const campaign = await campaignForOwner(request, slug);
    if (!campaign) return Response.json({ error: "This auction was not found." }, { status: 404 });
    if (!campaign.stripeAccountId) {
      return Response.json({ connected: false, ready: false });
    }
    const account = await syncAccount(campaign.id, campaign.stripeAccountId);
    return Response.json({
      connected: true,
      ready: account.chargesEnabled && account.payoutsEnabled,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
    });
  } catch (error) {
    if (error instanceof XAuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to read Stripe Connect status", error);
    return Response.json({ error: "Stripe status could not be loaded." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) return unavailable();
  try {
    const { slug } = await context.params;
    const owner = await getPublishingOwner(request);
    const campaign = await getOwnedStripeCampaign(slug, owner);
    if (!campaign) return Response.json({ error: "This auction was not found." }, { status: 404 });

    const stripe = getStripe();
    let accountId = campaign.stripeAccountId;
    if (!accountId) {
      const account = await stripe.v2.core.accounts.create({
        contact_email: owner.ownerEmail,
        dashboard: "express",
        display_name: campaign.title,
        defaults: {
          profile: {
            business_url: publicLaptopUrl(campaign.slug),
            product_description: "Auctioned brand placement on a creator-owned object.",
          },
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
        },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
        include: ["configuration.merchant", "requirements"],
        metadata: {
          brand_anything_laptop_id: campaign.id,
          brand_anything_slug: campaign.slug,
        },
      }, { idempotencyKey: `ba-${stripeEnvironment()}-connect-${campaign.id}` });
      accountId = account.id;
      await setStripeCampaignAccount(
        campaign.id,
        account.id,
        false,
        false,
      );
    }

    const account = await syncAccount(campaign.id, accountId);
    if (account.chargesEnabled && account.payoutsEnabled) {
      return Response.json({ connected: true, ready: true, returnUrl: laptopUrl(campaign.slug) });
    }

    const returnUrl = new URL("/sell", SITE_URL);
    returnUrl.searchParams.set("stripe", "return");
    returnUrl.searchParams.set("slug", campaign.slug);
    const refreshUrl = new URL("/sell", SITE_URL);
    refreshUrl.searchParams.set("stripe", "refresh");
    refreshUrl.searchParams.set("slug", campaign.slug);

    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: refreshUrl.toString(),
          return_url: returnUrl.toString(),
          collection_options: { fields: "eventually_due", future_requirements: "include" },
        },
      },
    });
    return Response.json({ connected: true, ready: false, onboardingUrl: accountLink.url });
  } catch (error) {
    if (error instanceof XAuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      console.error("Stripe Connect key is missing permissions", {
        code: error.code,
        requestId: error.requestId,
      });
      return Response.json(
        { error: "The Stripe key needs Core: Write permission for Accounts v2." },
        { status: 503 },
      );
    }
    console.error("Failed to start Stripe Connect onboarding", error);
    return Response.json(
      { error: "Stripe onboarding could not be started. Check that Connect is enabled on the platform account." },
      { status: 500 },
    );
  }
}
