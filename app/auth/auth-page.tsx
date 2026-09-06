"use client";

import type { Session, User } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PreferenceControls } from "@/app/preference-controls";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import { AuthForm, type AuthMode } from "./auth-form";
import styles from "./auth.module.css";

type AuthPageProps = {
  initialMode: AuthMode;
  emailConfirmed: boolean;
};

function accountLabel(user: User) {
  return user.email
    || String(user.user_metadata.user_name || user.user_metadata.name || "Brand Anything account");
}

function accountAvatar(user: User) {
  const value = user.user_metadata.avatar_url || user.user_metadata.picture;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}

function accountInitial(user: User) {
  return accountLabel(user).trim().slice(0, 1).toUpperCase() || "B";
}

function providerLabel(user: User) {
  const provider = String(user.app_metadata.provider || "email");
  if (provider === "github") return "GitHub";
  if (provider === "x" || provider === "twitter") return "X";
  return "Email & password";
}

export function AuthPage({ initialMode, emailConfirmed }: AuthPageProps) {
  const configured = isSupabaseBrowserConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const callbackParameters = new URLSearchParams([
      window.location.search.replace(/^\?/, ""),
      window.location.hash.replace(/^#/, ""),
    ].filter(Boolean).join("&"));
    const callbackError = callbackParameters.get("error_description")
      || callbackParameters.get("error_code")
      || (callbackParameters.get("error") ? "Sign in did not complete. Please try again." : "");
    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
      if (session) setSessionError("");
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setReady(true);
      setSessionError(callbackError || error?.message || "");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  const handleAuthenticated = (session: Session) => {
    setSessionError("");
    setUser(session.user);
  };

  const handleSignOut = async () => {
    if (!configured || signingOut) return;
    setSigningOut(true);
    setSessionError("");
    const { error } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
    if (error) setSessionError(error.message);
    else setUser(null);
    setSigningOut(false);
  };

  const avatar = user ? accountAvatar(user) : "";

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#auth-content">Skip to account access</a>
      <nav className="site-nav" aria-label="Primary">
        <div className="nav-inner">
          <Link className="wordmark" href="/" aria-label="Brand Anything home">
            <Image src="/logo-small.png" alt="" width={41} height={41} priority />
            <span>Brand Anything</span>
          </Link>
          <div className="nav-actions">
            <PreferenceControls />
            <Link className={styles.homeLink} href="/">Back home</Link>
          </div>
        </div>
      </nav>

      <main className={styles.main} id="auth-content">
        <section className={styles.story} aria-labelledby="auth-page-title">
          <p className={styles.kicker}><span /> One account · every auction</p>
          <h1 id="auth-page-title">Sign in once.<br /><em>Make anything visible.</em></h1>
          <p className={styles.lead}>Bid for a brand spot, publish your own object, and return to manage it with the same identity.</p>

          <div className={styles.placementCanvas} aria-hidden="true">
            <div className={styles.canvasLabel}><span>Live identity</span><b>01</b></div>
            <div className={styles.objectMark}>
              <Image src="/logo-small.png" alt="" width={96} height={96} />
            </div>
            {[1, 2, 3, 4, 5, 6].map((spot) => <i key={spot} data-spot={spot} />)}
            <p><span /> Your account travels with every object</p>
          </div>
        </section>

        <section className={styles.authColumn} aria-label="Account access">
          {!ready ? (
            <div className={styles.loadingPanel} role="status">
              <span />
              <p>Checking your account…</p>
            </div>
          ) : user ? (
            <div className={styles.accountPanel}>
              <p className={styles.accountKicker}>You&apos;re in</p>
              <div className={styles.accountIdentity}>
                <span className={styles.largeAvatar}>
                  {avatar ? (
                    // OAuth profile images come from the authenticated provider.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <b aria-hidden="true">{accountInitial(user)}</b>
                  )}
                </span>
                <div>
                  <h2>{accountLabel(user)}</h2>
                  <p>Signed in with {providerLabel(user)}</p>
                </div>
              </div>
              <p className={styles.accountCopy}>Your account is ready for bidding, publishing, and managing every Brand Anything auction.</p>
              {sessionError && <p className={styles.sessionError} role="alert">{sessionError}</p>}
              <div className={styles.accountActions}>
                <Link href="/sell">Create an auction <span aria-hidden="true">↗</span></Link>
                <Link href="/">Explore auctions</Link>
              </div>
              <button className={styles.signOut} type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : (
            <>
              {(sessionError || emailConfirmed) && (
                <p className={sessionError ? styles.sessionError : styles.confirmedMessage} role={sessionError ? "alert" : "status"}>
                  {sessionError || "Email confirmed. Sign in to continue."}
                </p>
              )}
              <AuthForm
                initialMode={initialMode}
                ready={ready}
                onAuthenticated={handleAuthenticated}
              />
              <p className={styles.legalLine}>By continuing, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
