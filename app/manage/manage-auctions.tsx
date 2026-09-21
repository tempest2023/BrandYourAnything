"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccountNav } from "@/app/auth/account-nav";
import {
  forgetManagedAuction,
  generateManagerRecoveryCode,
  isManagerRecoveryCode,
  loadManagedAuctions,
  MANAGED_AUCTIONS_CHANGE_EVENT,
  rememberManagedAuction,
  type ManagedAuction,
} from "@/lib/managed-auctions";
import { auctionPath } from "@/lib/site";
import { DEFAULT_CONNECT_COUNTRY, STRIPE_CONNECT_COUNTRIES } from "@/lib/stripe-countries";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import styles from "./manage.module.css";

type AuctionSummary = {
  id: string;
  slug: string;
  title: string;
  status: "published" | "closed";
  closesAt: string;
  createdAt: string;
  claimedByAccount: boolean;
  browserRecoveryEnabled: boolean;
  stripeConnected: boolean;
  paymentsEnabled: boolean;
};

type BrowserAuctionState = {
  saved: ManagedAuction;
  auction: AuctionSummary | null;
  error: string | null;
};

type AuctionView = {
  auction: AuctionSummary;
  recoveryCode: string | null;
  savedInBrowser: boolean;
  ownedByAccount: boolean;
};

type ApiPayload = {
  closed?: boolean;
  auction?: AuctionSummary;
  auctions?: AuctionSummary[];
  error?: string;
  ready?: boolean;
  onboardingUrl?: string;
};

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^\/+|\/+$/g, "")
    .split(/[?#]/, 1)[0];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

async function readPayload(response: Response) {
  const payload = await response.json() as ApiPayload;
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Copy was blocked by the browser.");
  }
}

export function ManageAuctions() {
  const router = useRouter();
  const authConfigured = isSupabaseBrowserConfigured();
  const accountRequest = useRef(0);
  const currentToken = useRef<string | null>(null);
  const browserRequest = useRef(0);
  const handledReturn = useRef(false);
  const [browserAuctions, setBrowserAuctions] = useState<BrowserAuctionState[]>([]);
  const [accountAuctions, setAccountAuctions] = useState<AuctionSummary[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!authConfigured);
  const [loadingBrowser, setLoadingBrowser] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [importSlug, setImportSlug] = useState("");
  const [importCode, setImportCode] = useState("");
  const [unsavedRecovery, setUnsavedRecovery] = useState<{ slug: string; code: string } | null>(null);
  const [stripeCountry, setStripeCountry] = useState<Record<string, string>>({});

  const refreshBrowserAuctions = useCallback(async (saved = loadManagedAuctions()) => {
    const version = ++browserRequest.current;
    setLoadingBrowser(true);
    const states = await Promise.all(saved.map(async (entry): Promise<BrowserAuctionState> => {
      try {
        const response = await fetch(`/api/auctions/${encodeURIComponent(entry.slug)}/manage`, {
          headers: { "X-Auction-Manager-Key": entry.recoveryCode },
          cache: "no-store",
        });
        const payload = await readPayload(response);
        if (!payload.auction) throw new Error("The auction could not be loaded.");
        return { saved: { ...entry, title: payload.auction.title }, auction: payload.auction, error: null };
      } catch (requestError) {
        return {
          saved: entry,
          auction: null,
          error: requestError instanceof Error ? requestError.message : "The auction could not be loaded.",
        };
      }
    }));
    if (version !== browserRequest.current) return;
    setBrowserAuctions(states);
    setLoadingBrowser(false);
  }, []);

  const refreshAccountAuctions = useCallback(async (token: string | null) => {
    if (token !== currentToken.current) return;
    const version = ++accountRequest.current;
    if (!token) {
      setAccountAuctions([]);
      setLoadingAccount(false);
      return;
    }
    setLoadingAccount(true);
    try {
      const payload = await readPayload(await fetch("/api/auctions/mine", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }));
      if (version === accountRequest.current) setAccountAuctions(payload.auctions ?? []);
    } catch (requestError) {
      if (version === accountRequest.current) setError(requestError instanceof Error ? requestError.message : "Your auctions could not be loaded.");
    } finally {
      if (version === accountRequest.current) setLoadingAccount(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshBrowserAuctions(), 0);
    const refresh = () => void refreshBrowserAuctions();
    const requests = browserRequest;
    window.addEventListener("storage", refresh);
    window.addEventListener(MANAGED_AUCTIONS_CHANGE_EVENT, refresh);
    return () => {
      window.clearTimeout(timer);
      ++requests.current;
      window.removeEventListener("storage", refresh);
      window.removeEventListener(MANAGED_AUCTIONS_CHANGE_EVENT, refresh);
    };
  }, [refreshBrowserAuctions]);

  useEffect(() => {
    if (!authConfigured) return;
    let active = true;
    const requests = accountRequest;
    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const token = session?.access_token ?? null;
      if (currentToken.current !== token) setAccountAuctions([]);
      currentToken.current = token;
      setAccessToken(token);
      setAuthReady(true);
      void refreshAccountAuctions(token);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const token = data.session?.access_token ?? null;
      currentToken.current = token;
      setAccessToken(token);
      setAuthReady(true);
      void refreshAccountAuctions(token);
    });
    return () => {
      active = false;
      ++requests.current;
      listener.subscription.unsubscribe();
    };
  }, [refreshAccountAuctions, authConfigured]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const auctions = useMemo(() => {
    const merged = new Map<string, AuctionView>();
    for (const entry of browserAuctions) {
      if (!entry.auction) continue;
      merged.set(entry.auction.slug, {
        auction: entry.auction,
        recoveryCode: entry.saved.recoveryCode,
        savedInBrowser: true,
        ownedByAccount: false,
      });
    }
    for (const auction of accountAuctions) {
      const existing = merged.get(auction.slug);
      merged.set(auction.slug, {
        auction,
        recoveryCode: existing?.recoveryCode ?? null,
        savedInBrowser: existing?.savedInBrowser ?? false,
        ownedByAccount: true,
      });
    }
    return [...merged.values()].sort((left, right) =>
      new Date(right.auction.createdAt).getTime() - new Date(left.auction.createdAt).getTime());
  }, [browserAuctions, accountAuctions]);

  const signIn = () => router.push("/auth?mode=sign-in&next=/manage");

  const signOut = async () => {
    if (!authConfigured) return;
    const { error: signOutError } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
    if (signOutError) { setError("Sign out failed. Please try again."); return; }
    ++accountRequest.current;
    currentToken.current = null;
    setAccessToken(null);
    setAccountAuctions([]);
  };

  const importAuction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busySlug) return;
    const slug = normalizeSlug(importSlug);
    const recoveryCode = importCode.trim();
    setError("");
    setFeedback("");
    if (!slug || !isManagerRecoveryCode(recoveryCode)) {
      setError("Enter the auction address and its complete recovery code.");
      return;
    }
    setBusySlug(slug);
    try {
      const payload = await readPayload(await fetch(`/api/auctions/${encodeURIComponent(slug)}/manage`, {
        headers: { "X-Auction-Manager-Key": recoveryCode },
        cache: "no-store",
      }));
      if (!payload.auction) throw new Error("The auction could not be loaded.");
      const saved = rememberManagedAuction({ slug, title: payload.auction.title, recoveryCode });
      await refreshBrowserAuctions(saved);
      setImportSlug("");
      setImportCode("");
      setFeedback("Auction added to this browser.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The recovery code could not be verified.");
    } finally {
      setBusySlug(null);
    }
  };

  const claimWithAccount = async (view: AuctionView) => {
    if (!accessToken || !view.recoveryCode) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      await readPayload(await fetch(`/api/auctions/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Auction-Manager-Key": view.recoveryCode,
        },
      }));
      await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
      setFeedback("Auction attached to your account.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The auction could not be attached.");
    } finally {
      setBusySlug(null);
    }
  };

  const closeAuction = async (view: AuctionView) => {
    const headers: Record<string, string> = view.ownedByAccount && accessToken
      ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
      : view.recoveryCode
        ? { "X-Auction-Manager-Key": view.recoveryCode, "Content-Type": "application/json" }
        : {};
    if (!Object.keys(headers).length) return;
    if (!window.confirm(`Close “${view.auction.title}”? New bids will stop immediately.`)) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      await readPayload(await fetch(`/api/auctions/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "closed" }),
      }));
      await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
      setFeedback("Auction closed. Its final results remain public.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The auction could not be closed.");
    } finally {
      setBusySlug(null);
    }
  };

  const rotateRecovery = async (view: AuctionView) => {
    if (!accessToken) return;
    const recoveryCode = generateManagerRecoveryCode();
    setBusySlug(view.auction.slug);
    setError("");
    setUnsavedRecovery(null);
    try {
      const response = await fetch(`/api/auctions/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryAction: "rotate", recoveryCode }),
      });
      const payload = await readPayload(response);
      if (!payload.auction) throw new Error("The new recovery code could not be confirmed.");
      try {
        rememberManagedAuction({
          slug: view.auction.slug,
          title: view.auction.title,
          recoveryCode,
        });
      } catch {
        setUnsavedRecovery({ slug: view.auction.slug, code: recoveryCode });
      }
      await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
      setFeedback("A new recovery code is active. Every older code is now invalid.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recovery access could not be rotated.");
    } finally {
      setBusySlug(null);
    }
  };

  const disableRecovery = async (view: AuctionView) => {
    if (!accessToken) return;
    if (!window.confirm(`Disable every recovery code for “${view.auction.title}”? Account sign-in will be the only way to manage it.`)) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      const payload = await readPayload(await fetch(`/api/auctions/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryAction: "disable" }),
      }));
      if (!payload.auction) throw new Error("Recovery access could not be disabled.");
      try {
        forgetManagedAuction(view.auction.slug);
      } catch {
        // The server credential is already disabled; stale local data is harmless.
      }
      await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
      setFeedback("Recovery access disabled. This auction now requires Account sign-in.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recovery access could not be disabled.");
    } finally {
      setBusySlug(null);
    }
  };

  const connectStripe = useCallback(async (view: AuctionView, method: "GET" | "POST" = "POST") => {
    const headers: Record<string, string> = view.ownedByAccount && accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : view.recoveryCode
        ? { "X-Auction-Manager-Key": view.recoveryCode }
        : {};
    if (!Object.keys(headers).length) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      const payload = await readPayload(await fetch(`/api/auctions/${encodeURIComponent(view.auction.slug)}/stripe/connect`, {
        method,
        headers: { ...headers, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify({ country: stripeCountry[view.auction.slug] || DEFAULT_CONNECT_COUNTRY }) } : {}),
      }));
      if (payload.closed) {
        await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
        setError("The connected Stripe account is closed. Contact support before reconnecting.");
      } else if (payload.ready) {
        await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
        setFeedback("Stripe payments are ready.");
      } else if (payload.onboardingUrl) {
        window.location.assign(payload.onboardingUrl);
      } else if (method === "GET") {
        await Promise.all([refreshBrowserAuctions(), refreshAccountAuctions(accessToken)]);
        setFeedback("Stripe setup is not complete. Choose Connect Stripe to continue in Stripe's hosted onboarding.");
      } else {
        throw new Error("Stripe did not return an onboarding link.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Stripe onboarding could not be started.");
    } finally {
      setBusySlug(null);
    }
  }, [accessToken, refreshAccountAuctions, refreshBrowserAuctions, stripeCountry]);

  useEffect(() => {
    if (!authReady || loadingBrowser || loadingAccount || handledReturn.current) return;
    const query = new URLSearchParams(window.location.search);
    const action = query.get("stripe");
    const slug = query.get("slug");
    if ((action !== "return" && action !== "refresh") || !slug) return;
    const timer = window.setTimeout(() => {
      handledReturn.current = true;
      const view = auctions.find((entry) => entry.auction.slug === slug);
      if (!view) {
        setError("Sign in with the owning account or import this auction's recovery code, then refresh Stripe status.");
        setImportSlug(slug);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      url.searchParams.delete("slug");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      void connectStripe(view, action === "refresh" ? "POST" : "GET");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authReady, loadingBrowser, loadingAccount, auctions, connectStripe]);

  const forgetAuction = (view: AuctionView) => {
    try {
      const next = forgetManagedAuction(view.auction.slug);
      void refreshBrowserAuctions(next);
      setFeedback("Recovery code removed from this browser.");
    } catch { setError("This browser blocked changes to saved recovery codes."); }
  };

  const invalidBrowserAuctions = browserAuctions.filter((entry) => !entry.auction);
  const loading = loadingBrowser || loadingAccount || !authReady;
  const liveAuctionCount = auctions.filter((view) => view.auction.status === "published").length;
  const liveAuctionShare = auctions.length ? Math.round((liveAuctionCount / auctions.length) * 100) : 0;

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#manage-content">Skip to auction management</a>
      <nav className="site-nav" aria-label="Auction management">
        <div className="nav-inner">
          <Link href="/" className="wordmark" aria-label="Brand Anything home">
            <Image src="/logo-small.png" alt="" width={41} height={41} priority />
            <span>Brand Anything</span>
          </Link>
          <div className="nav-links">
            <Link className="nav-link--how" href="/">Marketplace</Link>
            <Link className="nav-link--faq" href="/sell">Create</Link>
          </div>
          <div className="nav-actions">
            <Link className="dark-button" href="/sell">Create auction</Link>
            <AccountNav />
          </div>
        </div>
      </nav>

      <main id="manage-content">
        <header className={`hero ${styles.manageHero}`} id="top">
          <div className="live-visitors"><span />Owner workspace</div>
          <p className="total-visits"><span>·</span>{auctions.length === 1 ? "1 auction available" : `${auctions.length} auctions available`}</p>
          <h1>Manage your auctions.</h1>
          <p className="hero-subtitle">Review activity, finish payout setup, and keep every recovery path in one place.</p>

          <div className="funding" aria-label={`${auctions.length} auctions, ${liveAuctionCount} live`}>
            <div className="funding-row">
              <p><strong>{auctions.length}</strong><span>{auctions.length === 1 ? "auction" : "auctions"}</span></p>
              <p>{liveAuctionCount} live · {liveAuctionShare}% active</p>
            </div>
            <div className="progress-track"><span style={{ width: `${liveAuctionShare}%` }} /></div>
            <p className="auction-time">{accessToken ? "Synced with your account" : "Saved on this browser until you sign in"}</p>
          </div>

          <section className={`payment-notice ${accessToken ? "payment-notice--accepted" : ""} ${styles.accountNotice}`} aria-labelledby="identity-title">
            <span className={styles.accountIndicator} data-active={Boolean(accessToken)} aria-hidden="true" />
            <div>
              <strong id="identity-title">{accessToken ? "Account connected" : "Take your auctions with you"}</strong>
              <p>{accessToken
                ? "Account-owned auctions are available anywhere you sign in. Recovery codes still work as a backup."
                : "Sign in to attach browser auctions to your account, or continue with recovery codes only."}</p>
            </div>
            {authConfigured ? accessToken ? (
              <button type="button" className={styles.noticeTextAction} onClick={() => void signOut()}>Sign out</button>
            ) : (
              <button type="button" className="dark-button" disabled={!authReady} onClick={() => signIn()}>Sign in</button>
            ) : (
              <span className={styles.xUnavailable}>Recovery access only</span>
            )}
          </section>

          {(feedback || error) && (
            <div className={`payment-notice ${error ? styles.errorMessage : "payment-notice--accepted"} ${styles.feedback}`} role={error ? "alert" : "status"}>
              {error || feedback}
            </div>
          )}

          {unsavedRecovery && (
            <section className={styles.unsavedRecovery} aria-labelledby="unsaved-recovery-title">
              <div>
                <p className="eyebrow">Save before leaving</p>
                <h2 id="unsaved-recovery-title">This browser blocked local saving.</h2>
                <p>The new code is active for /{unsavedRecovery.slug}. Copy it now; older recovery codes no longer work.</p>
              </div>
              <code>{unsavedRecovery.code}</code>
              <button type="button" className="dark-button" onClick={() => void copyText(unsavedRecovery.code).then(() => setFeedback("Recovery code copied."))}>Copy recovery code</button>
            </section>
          )}
        </header>

        <section className={`auction-section ${styles.auctionSection}`} aria-labelledby="auctions-title">
          <div className="section-inner auction-inner">
            <p className="auction-status">{liveAuctionCount > 0 && <span />}{loading ? "Checking access…" : `${liveAuctionCount} live · ${auctions.length} total`}</p>
            <h2 id="auctions-title">Your auctions.</h2>
            <p className="section-lead">Everything you can operate from this browser or account.</p>
            <p className="section-copy">Open a public auction, check payout readiness, or expand a row for access and lifecycle controls.</p>

            {/* Only the country is collected up front; Stripe's hosted onboarding
                collects the business, bank and capability details. */}
            <datalist id="stripe-connect-countries">
              {STRIPE_CONNECT_COUNTRIES.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>

            {loading ? (
              <div className={styles.loadingState} role="status">
                <span aria-hidden="true" />
                <strong>Checking your auctions</strong>
                <small>Reading this browser and your account.</small>
              </div>
            ) : auctions.length ? (
              <div className={styles.auctionList} role="list">
                <div className={styles.auctionListHeader} aria-hidden="true">
                  <span>Auction</span><span>Status</span><span>Payouts</span><span>Action</span>
                </div>
                {auctions.map((view, index) => (
                  <article className={styles.auctionRow} key={view.auction.id} role="listitem">
                    <div className={styles.auctionIdentity}>
                      <span className="spot-number">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <h3><Link href={auctionPath(view.auction.slug)}>{view.auction.title}</Link></h3>
                        <p>/{view.auction.slug}</p>
                        <div className={styles.ownershipLine}>
                          {view.ownedByAccount && <span>Account</span>}
                          {view.savedInBrowser && <span>This browser</span>}
                        </div>
                      </div>
                    </div>
                    <div className={styles.stateCell}>
                      <span className={view.auction.status === "closed" ? styles.closedStatus : styles.liveStatus}>
                        <i aria-hidden="true" />{view.auction.status === "closed" ? "Closed" : "Live"}
                      </span>
                      <small>{view.auction.status === "closed" ? "Final results" : `Closes ${formatDate(view.auction.closesAt)}`}</small>
                    </div>
                    <div className={styles.paymentCell} data-ready={view.auction.paymentsEnabled} data-closed={view.auction.status === "closed"}>
                      <i aria-hidden="true" />
                      <div>
                        <strong>{view.auction.status === "closed" ? "Bidding closed" : view.auction.paymentsEnabled ? "Payments ready" : view.auction.stripeConnected ? "Stripe pending" : "Not connected"}</strong>
                        <small>{view.auction.status === "closed" ? "No new bids" : view.auction.paymentsEnabled ? "Accepting bids" : "Setup required"}</small>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <Link className="text-link" href={auctionPath(view.auction.slug)}>Open ↗</Link>
                      {!view.auction.paymentsEnabled && view.auction.status === "published" && (
                        <button type="button" className="outbid-button" disabled={busySlug === view.auction.slug} onClick={() => void connectStripe(view)}>
                          {view.auction.stripeConnected ? "Continue" : "Set up"}
                        </button>
                      )}
                    </div>

                    <details className={styles.managementDetails}>
                      <summary><span>Access and auction settings</span><i aria-hidden="true">+</i></summary>
                      <div className={styles.settingsGrid}>
                      <section>
                        <p className="eyebrow">Payouts</p>
                        <h4>{view.auction.status === "closed" ? "Auction closed" : view.auction.paymentsEnabled ? "Ready to accept bids" : "Finish Stripe setup"}</h4>
                        <p>{view.auction.status === "closed" ? "Payout settings are retained with the final results." : view.auction.paymentsEnabled ? "Stripe is connected and payments are enabled." : "Stripe collects business and bank details in its hosted onboarding."}</p>
                        {!view.auction.stripeConnected && view.auction.status === "published" && (
                          <label className={styles.countryField}>
                            Business country code
                            <input list="stripe-connect-countries" value={stripeCountry[view.auction.slug] ?? DEFAULT_CONNECT_COUNTRY}
                              maxLength={2} disabled={busySlug === view.auction.slug}
                              onChange={(event) => setStripeCountry((current) => ({ ...current, [view.auction.slug]: event.target.value.toUpperCase() }))} />
                          </label>
                        )}
                        <div className={styles.settingsActions}>
                          {!view.auction.paymentsEnabled && view.auction.status === "published" && (
                            <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void connectStripe(view)}>{view.auction.stripeConnected ? "Continue setup" : "Connect Stripe"}</button>
                          )}
                          {view.auction.stripeConnected && (
                            <button type="button" disabled={Boolean(busySlug)} onClick={() => void connectStripe(view, "GET")}>Refresh status</button>
                          )}
                        </div>
                      </section>

                      <section>
                        <p className="eyebrow">Account access</p>
                        <h4>{view.ownedByAccount ? "Attached to your account" : "Browser recovery only"}</h4>
                        <p>{view.ownedByAccount ? "Sign in to manage this auction on another device." : "Attach this auction to use it anywhere you sign in."}</p>
                        <div className={styles.settingsActions}>
                          {accessToken && view.recoveryCode && !view.ownedByAccount && (
                            <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void claimWithAccount(view)}>Attach to account</button>
                          )}
                          {accessToken && view.ownedByAccount && (
                            <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void rotateRecovery(view)}>
                              {view.auction.browserRecoveryEnabled ? "Rotate recovery code" : "Create recovery code"}
                            </button>
                          )}
                        </div>
                      </section>

                      {view.recoveryCode && (
                        <section className={styles.recoveryDetails}>
                          <p className="eyebrow">Recovery code</p>
                          <h4>Keep this private</h4>
                          <p>Anyone with this code can manage the auction.</p>
                          <code>{view.recoveryCode}</code>
                          <div className={styles.settingsActions}>
                            <button type="button" onClick={() => void copyText(view.recoveryCode!).then(() => setFeedback("Recovery code copied."))}>Copy code</button>
                            <button type="button" onClick={() => forgetAuction(view)}>Remove from browser</button>
                          </div>
                        </section>
                      )}

                      {(view.auction.status === "published" || (accessToken && view.ownedByAccount && view.auction.browserRecoveryEnabled)) && (
                        <section className={styles.dangerZone}>
                          <p className="eyebrow">Sensitive actions</p>
                          <h4>Changes take effect immediately</h4>
                          <p>Closing stops new bids. Disabling recovery makes account sign-in the only way back in.</p>
                          <div className={styles.settingsActions}>
                            {accessToken && view.ownedByAccount && view.auction.browserRecoveryEnabled && (
                              <button type="button" className={styles.dangerAction} disabled={busySlug === view.auction.slug} onClick={() => void disableRecovery(view)}>Disable recovery</button>
                            )}
                            {view.auction.status === "published" && (
                              <button type="button" className={styles.dangerAction} disabled={busySlug === view.auction.slug} onClick={() => void closeAuction(view)}>Close auction</button>
                            )}
                          </div>
                        </section>
                      )}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <div className={`history-empty ${styles.emptyState}`}>
                <span aria-hidden="true">01</span>
                <strong>No auctions here yet</strong>
                <p>Create your first auction, import a recovery code below, or sign in with the owner account.</p>
                <Link className="primary-button" href="/sell">Create an auction</Link>
              </div>
            )}

            {invalidBrowserAuctions.length > 0 && (
              <section className={styles.invalidSection} aria-labelledby="invalid-title">
                <h3 id="invalid-title">Saved keys needing attention</h3>
                {invalidBrowserAuctions.map((entry) => (
                  <div key={entry.saved.slug}>
                    <span>/{entry.saved.slug}</span>
                    <p>{entry.error}</p>
                    <button type="button" onClick={() => {
                      try {
                        const next = forgetManagedAuction(entry.saved.slug);
                        void refreshBrowserAuctions(next);
                      } catch { setError("This browser blocked changes to saved recovery codes."); }
                    }}>Remove saved key</button>
                  </div>
                ))}
              </section>
            )}
          </div>
        </section>

        <section className={`how-section ${styles.recoverySection}`} aria-labelledby="import-title">
          <div className="section-inner">
            <p className="eyebrow">Recovery access</p>
            <h2 id="import-title">Manage another auction.</h2>
            <p className="section-lead">Bring an existing auction into this browser.</p>
            <p className="section-copy">Use the address and recovery code shown when the auction was created. The code is verified before it is saved on this device.</p>
            <form className={`form-grid ${styles.recoveryForm}`} onSubmit={importAuction}>
              <label>
                Auction address
                <input value={importSlug} onChange={(event) => setImportSlug(event.target.value)} placeholder="brand-anything.vercel.app/your-auction" autoCapitalize="none" />
              </label>
              <label>
                Recovery code
                <input value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="ba_mgr_…" autoCapitalize="none" autoComplete="off" spellCheck={false} />
              </label>
              <button className="primary-button" type="submit" disabled={Boolean(busySlug)}>Verify and add auction</button>
            </form>
          </div>
        </section>
      </main>
      <Link className="floating-cta" href="/sell">Create auction →</Link>
    </div>
  );
}
