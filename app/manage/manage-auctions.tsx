"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  forgetManagedAuction,
  generateManagerRecoveryCode,
  isManagerRecoveryCode,
  loadManagedAuctions,
  rememberManagedAuction,
  type ManagedAuction,
} from "@/lib/managed-auctions";
import { laptopPath } from "@/lib/site";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import { signInWithX as startXSignIn } from "@/lib/x-auth-browser";

import styles from "./manage.module.css";

type AuctionSummary = {
  id: string;
  slug: string;
  title: string;
  status: "published" | "closed";
  closesAt: string;
  createdAt: string;
  claimedByX: boolean;
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
  ownedByX: boolean;
};

type ApiPayload = {
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
  const xConfigured = isSupabaseBrowserConfigured();
  const [browserAuctions, setBrowserAuctions] = useState<BrowserAuctionState[]>([]);
  const [xAuctions, setXAuctions] = useState<AuctionSummary[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(true);
  const [loadingBrowser, setLoadingBrowser] = useState(true);
  const [loadingX, setLoadingX] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [importSlug, setImportSlug] = useState("");
  const [importCode, setImportCode] = useState("");
  const [unsavedRecovery, setUnsavedRecovery] = useState<{ slug: string; code: string } | null>(null);

  const refreshBrowserAuctions = useCallback(async (saved = loadManagedAuctions()) => {
    setLoadingBrowser(true);
    const states = await Promise.all(saved.map(async (entry): Promise<BrowserAuctionState> => {
      try {
        const response = await fetch(`/api/laptops/${encodeURIComponent(entry.slug)}/manage`, {
          headers: { "X-Lid-Manager-Key": entry.recoveryCode },
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
    setBrowserAuctions(states);
    setLoadingBrowser(false);
  }, []);

  const refreshXAuctions = useCallback(async (token: string | null) => {
    if (!token) {
      setXAuctions([]);
      setLoadingX(false);
      return;
    }
    setLoadingX(true);
    try {
      const payload = await readPayload(await fetch("/api/laptops/mine", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }));
      setXAuctions(payload.auctions ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your X auctions could not be loaded.");
    } finally {
      setLoadingX(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshBrowserAuctions(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshBrowserAuctions]);

  useEffect(() => {
    if (!xConfigured) return;
    let active = true;
    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const token = session?.access_token ?? null;
      setAccessToken(token);
      setAuthReady(true);
      void refreshXAuctions(token);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const token = data.session?.access_token ?? null;
      setAccessToken(token);
      setAuthReady(true);
      void refreshXAuctions(token);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [refreshXAuctions, xConfigured]);

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
        ownedByX: false,
      });
    }
    for (const auction of xAuctions) {
      const existing = merged.get(auction.slug);
      merged.set(auction.slug, {
        auction,
        recoveryCode: existing?.recoveryCode ?? null,
        savedInBrowser: existing?.savedInBrowser ?? false,
        ownedByX: true,
      });
    }
    return [...merged.values()].sort((left, right) =>
      new Date(right.auction.createdAt).getTime() - new Date(left.auction.createdAt).getTime());
  }, [browserAuctions, xAuctions]);

  const signInWithX = async () => {
    if (!xConfigured) return;
    setError("");
    try {
      await startXSignIn(`${window.location.origin}/manage`);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "X sign-in could not be started.");
    }
  };

  const signOut = async () => {
    if (!xConfigured) return;
    await getSupabaseBrowser().auth.signOut({ scope: "local" });
    setAccessToken(null);
    setXAuctions([]);
  };

  const importAuction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      const payload = await readPayload(await fetch(`/api/laptops/${encodeURIComponent(slug)}/manage`, {
        headers: { "X-Lid-Manager-Key": recoveryCode },
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

  const claimWithX = async (view: AuctionView) => {
    if (!accessToken || !view.recoveryCode) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      await readPayload(await fetch(`/api/laptops/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Lid-Manager-Key": view.recoveryCode,
        },
      }));
      await Promise.all([refreshBrowserAuctions(), refreshXAuctions(accessToken)]);
      setFeedback("Auction attached to your X account.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The auction could not be attached.");
    } finally {
      setBusySlug(null);
    }
  };

  const closeAuction = async (view: AuctionView) => {
    const headers: Record<string, string> = view.ownedByX && accessToken
      ? { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
      : view.recoveryCode
        ? { "X-Lid-Manager-Key": view.recoveryCode, "Content-Type": "application/json" }
        : {};
    if (!Object.keys(headers).length) return;
    if (!window.confirm(`Close “${view.auction.title}”? New bids will stop immediately.`)) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      await readPayload(await fetch(`/api/laptops/${encodeURIComponent(view.auction.slug)}/manage`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "closed" }),
      }));
      await Promise.all([refreshBrowserAuctions(), refreshXAuctions(accessToken)]);
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
      const response = await fetch(`/api/laptops/${encodeURIComponent(view.auction.slug)}/manage`, {
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
      await Promise.all([refreshBrowserAuctions(), refreshXAuctions(accessToken)]);
      setFeedback("A new recovery code is active. Every older code is now invalid.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recovery access could not be rotated.");
    } finally {
      setBusySlug(null);
    }
  };

  const disableRecovery = async (view: AuctionView) => {
    if (!accessToken) return;
    if (!window.confirm(`Disable every recovery code for “${view.auction.title}”? X sign-in will be the only way to manage it.`)) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      const payload = await readPayload(await fetch(`/api/laptops/${encodeURIComponent(view.auction.slug)}/manage`, {
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
      await Promise.all([refreshBrowserAuctions(), refreshXAuctions(accessToken)]);
      setFeedback("Recovery access disabled. This auction now requires X sign-in.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recovery access could not be disabled.");
    } finally {
      setBusySlug(null);
    }
  };

  const connectStripe = async (view: AuctionView) => {
    const headers: Record<string, string> = view.ownedByX && accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : view.recoveryCode
        ? { "X-Lid-Manager-Key": view.recoveryCode }
        : {};
    if (!Object.keys(headers).length) return;
    setBusySlug(view.auction.slug);
    setError("");
    try {
      const payload = await readPayload(await fetch(`/api/laptops/${encodeURIComponent(view.auction.slug)}/stripe/connect`, {
        method: "POST",
        headers,
      }));
      if (payload.ready) {
        await Promise.all([refreshBrowserAuctions(), refreshXAuctions(accessToken)]);
        setFeedback("Stripe payments are ready.");
      } else if (payload.onboardingUrl) {
        window.location.assign(payload.onboardingUrl);
      } else {
        throw new Error("Stripe did not return an onboarding link.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Stripe onboarding could not be started.");
      setBusySlug(null);
    }
  };

  const forgetAuction = (view: AuctionView) => {
    const next = forgetManagedAuction(view.auction.slug);
    void refreshBrowserAuctions(next);
    setFeedback("Recovery code removed from this browser.");
  };

  const invalidBrowserAuctions = browserAuctions.filter((entry) => !entry.auction);
  const loading = loadingBrowser || loadingX || !authReady;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.logo} aria-label="Brand Anything home">
          <Image src="/logo-small.png" alt="" width={44} height={44} priority />
          <span>Brand Anything</span>
        </Link>
        <nav aria-label="Auction management">
          <Link href="/">Marketplace</Link>
          <Link className={styles.createLink} href="/sell">Create auction</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p>Owner workspace</p>
          <h1>Your auctions,<br />without another password.</h1>
          <div className={styles.heroAside}>
            <span>{auctions.length}</span>
            <p>{auctions.length === 1 ? "auction available" : "auctions available"} on this device or through X.</p>
          </div>
        </section>

        <section className={styles.identityBar} aria-labelledby="identity-title">
          <div>
            <p className={styles.sectionKicker}>Account layer</p>
            <h2 id="identity-title">{accessToken ? "Connected to X" : "Carry your auctions across browsers"}</h2>
            <p>{accessToken
              ? "Auctions attached to this X identity appear wherever you sign in. Recovery codes remain valid as a backup."
              : "Sign in with X to attach saved auctions to one identity. You can also stay accountless and keep their recovery codes."}</p>
          </div>
          {xConfigured ? accessToken ? (
            <button type="button" className={styles.secondaryAction} onClick={() => void signOut()}>Sign out</button>
          ) : (
            <button type="button" className={styles.xAction} disabled={!authReady} onClick={() => void signInWithX()}>
              Sign in with X
            </button>
          ) : (
            <span className={styles.xUnavailable}>Use a recovery code below</span>
          )}
        </section>

        {(feedback || error) && (
          <div className={error ? styles.errorMessage : styles.feedback} role={error ? "alert" : "status"}>
            {error || feedback}
          </div>
        )}

        {unsavedRecovery && (
          <section className={styles.unsavedRecovery} aria-labelledby="unsaved-recovery-title">
            <div>
              <p className={styles.sectionKicker}>Save before leaving</p>
              <h2 id="unsaved-recovery-title">This browser blocked local saving.</h2>
              <p>The new code is active for /{unsavedRecovery.slug}. Copy it now; older recovery codes no longer work.</p>
            </div>
            <code>{unsavedRecovery.code}</code>
            <button type="button" onClick={() => void copyText(unsavedRecovery.code).then(() => setFeedback("Recovery code copied."))}>Copy recovery code</button>
          </section>
        )}

        <section className={styles.auctionSection} aria-labelledby="auctions-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionKicker}>Inventory</p>
              <h2 id="auctions-title">Auctions you can manage</h2>
            </div>
            <Link href="/sell">New auction <span aria-hidden="true">↗</span></Link>
          </div>

          {loading ? (
            <div className={styles.loadingState}>Checking ownership…</div>
          ) : auctions.length ? (
            <div className={styles.auctionList}>
              {auctions.map((view, index) => (
                <article className={styles.auctionRow} key={view.auction.id}>
                  <span className={styles.auctionIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.auctionIdentity}>
                    <div className={styles.statusLine}>
                      <span className={view.auction.status === "closed" ? styles.closedStatus : styles.liveStatus}>
                        {view.auction.status === "closed" ? "Closed" : "Live"}
                      </span>
                      {view.ownedByX && <span>Bound to X</span>}
                      {view.savedInBrowser && <span>Saved here</span>}
                    </div>
                    <h3><Link href={laptopPath(view.auction.slug)}>{view.auction.title}</Link></h3>
                    <p>/{view.auction.slug} · {view.auction.status === "closed" ? "Final results published" : `Closes ${formatDate(view.auction.closesAt)}`}</p>
                  </div>
                  <div className={styles.paymentState}>
                    <span>{view.auction.paymentsEnabled ? "Payments ready" : view.auction.stripeConnected ? "Stripe setup pending" : "Stripe not connected"}</span>
                    <i data-ready={view.auction.paymentsEnabled} aria-hidden="true" />
                  </div>
                  <div className={styles.rowActions}>
                    <Link href={laptopPath(view.auction.slug)}>Open</Link>
                    {!view.auction.paymentsEnabled && view.auction.status === "published" && (
                      <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void connectStripe(view)}>Connect Stripe</button>
                    )}
                    {accessToken && view.recoveryCode && !view.ownedByX && (
                      <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void claimWithX(view)}>Attach to X</button>
                    )}
                    {accessToken && view.ownedByX && (
                      <button type="button" disabled={busySlug === view.auction.slug} onClick={() => void rotateRecovery(view)}>
                        {view.auction.browserRecoveryEnabled ? "Rotate backup" : "Create backup"}
                      </button>
                    )}
                    {accessToken && view.ownedByX && view.auction.browserRecoveryEnabled && (
                      <button type="button" className={styles.dangerAction} disabled={busySlug === view.auction.slug} onClick={() => void disableRecovery(view)}>Disable recovery</button>
                    )}
                    {view.auction.status === "published" && (
                      <button type="button" className={styles.dangerAction} disabled={busySlug === view.auction.slug} onClick={() => void closeAuction(view)}>Close</button>
                    )}
                  </div>
                  {view.recoveryCode && (
                    <details className={styles.recoveryDetails}>
                      <summary>Recovery access</summary>
                      <div>
                        <p>Treat this code like a password. Anyone with it can manage this auction.</p>
                        <code>{view.recoveryCode}</code>
                        <div>
                          <button type="button" onClick={() => void copyText(view.recoveryCode!).then(() => setFeedback("Recovery code copied."))}>Copy code</button>
                          <button type="button" onClick={() => forgetAuction(view)}>Remove from browser</button>
                        </div>
                      </div>
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span aria-hidden="true">↗</span>
              <div>
                <h3>No auction keys are on this browser yet.</h3>
                <p>Create one here, import its recovery code below, or sign in with the X account that owns it.</p>
              </div>
              <Link href="/sell">Create your first auction</Link>
            </div>
          )}
        </section>

        {invalidBrowserAuctions.length > 0 && (
          <section className={styles.invalidSection} aria-labelledby="invalid-title">
            <h2 id="invalid-title">Saved keys needing attention</h2>
            {invalidBrowserAuctions.map((entry) => (
              <div key={entry.saved.slug}>
                <span>/{entry.saved.slug}</span>
                <p>{entry.error}</p>
                <button type="button" onClick={() => {
                  const next = forgetManagedAuction(entry.saved.slug);
                  void refreshBrowserAuctions(next);
                }}>Remove saved key</button>
              </div>
            ))}
          </section>
        )}

        <section className={styles.importSection} aria-labelledby="import-title">
          <div>
            <p className={styles.sectionKicker}>Recovery</p>
            <h2 id="import-title">Open an auction on this browser.</h2>
            <p>Paste the public address and the recovery code shown when it was created. We verify the code with the server before saving it locally.</p>
          </div>
          <form onSubmit={importAuction}>
            <label>
              Auction address
              <input value={importSlug} onChange={(event) => setImportSlug(event.target.value)} placeholder="brand-anything.vercel.app/your-auction" autoCapitalize="none" />
            </label>
            <label>
              Recovery code
              <input value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="ba_mgr_…" autoCapitalize="none" autoComplete="off" spellCheck={false} />
            </label>
            <button type="submit" disabled={Boolean(busySlug)}>Verify and add</button>
          </form>
        </section>
      </main>
    </div>
  );
}
