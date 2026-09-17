"use client";

import type { Session, User } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import type { TranslationKey } from "@/lib/i18n";
import { PreferenceControls } from "@/app/preference-controls";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import { AuthForm, type AuthMode } from "./auth-form";
import styles from "./auth.module.css";

type AuthPageProps = {
  initialMode: AuthMode;
  emailConfirmed: boolean;
  nextPath?: "/manage" | null;
};

function accountLabel(user: User, fallback = "B") {
  return user.email
    || String(user.user_metadata.user_name || user.user_metadata.name || fallback);
}

function accountAvatar(user: User) {
  const value = user.user_metadata.avatar_url || user.user_metadata.picture;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}

function accountInitial(user: User) {
  return accountLabel(user).trim().slice(0, 1).toUpperCase() || "B";
}

function providerLabel(user: User, emailLabel: string) {
  const provider = String(user.app_metadata.provider || "email");
  if (provider === "github") return "GitHub";
  if (provider === "x" || provider === "twitter") return "X";
  return emailLabel;
}

export function AuthPage({ initialMode, emailConfirmed, nextPath }: AuthPageProps) {
  const { t } = useI18n();
  const configured = isSupabaseBrowserConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState<TranslationKey | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (user && nextPath) window.location.replace(nextPath);
  }, [user, nextPath]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const callbackParameters = new URLSearchParams([
      window.location.search.replace(/^\?/, ""),
      window.location.hash.replace(/^#/, ""),
    ].filter(Boolean).join("&"));
    const callbackError = ["error_description", "error_code", "error"]
      .some((key) => callbackParameters.has(key));
    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
      if (session) setSessionError(null);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setReady(true);
      setSessionError(callbackError ? "auth.callbackFailed" : error ? "auth.sessionFailed" : null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  const handleAuthenticated = (session: Session) => {
    setSessionError(null);
    setUser(session.user);
  };

  const handleSignOut = async () => {
    if (!configured || signingOut) return;
    setSigningOut(true);
    setSessionError(null);
    const { error } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
    if (error) setSessionError("auth.signOutFailed");
    else setUser(null);
    setSigningOut(false);
  };

  const avatar = user ? accountAvatar(user) : "";

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#auth-content">{t("auth.skip")}</a>
      <nav className="site-nav" aria-label={t("auth.primary")}>
        <div className="nav-inner">
          <Link className="wordmark" href="/" aria-label={t("common.home")}>
            <Image src="/logo-small.png" alt="" width={41} height={41} priority />
            <span>Brand Anything</span>
          </Link>
          <div className="nav-actions">
            <PreferenceControls />
            <Link className={styles.homeLink} href="/">{t("auth.backHome")}</Link>
          </div>
        </div>
      </nav>

      <main className={styles.main} id="auth-content">
        <section className={styles.story} aria-labelledby="auth-page-title">
          <p className={styles.kicker}><span /> {t("auth.kicker")}</p>
          <h1 id="auth-page-title">{t("auth.headline")}<br /><em>{t("auth.headlineAccent")}</em></h1>
          <p className={styles.lead}>{t("auth.lead")}</p>

          <div className={styles.placementCanvas} aria-hidden="true">
            <div className={styles.canvasLabel}><span>{t("auth.liveIdentity")}</span><b>01</b></div>
            <div className={styles.objectMark}>
              <Image src="/logo-small.png" alt="" width={96} height={96} />
            </div>
            {[1, 2, 3, 4, 5, 6].map((spot) => <i key={spot} data-spot={spot} />)}
            <p><span /> {t("auth.travels")}</p>
          </div>
        </section>

        <section className={styles.authColumn} aria-label={t("auth.access")}>
          {!ready ? (
            <div className={styles.loadingPanel} role="status">
              <span />
              <p>{t("auth.checking")}</p>
            </div>
          ) : user ? (
            <div className={styles.accountPanel}>
              <p className={styles.accountKicker}>{t("auth.youreIn")}</p>
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
                  <h2>{accountLabel(user, t("auth.accountFallback"))}</h2>
                  <p>{t("auth.signedInWith", { provider: providerLabel(user, t("auth.emailPassword")) })}</p>
                </div>
              </div>
              <p className={styles.accountCopy}>{t("auth.accountCopy")}</p>
              {sessionError && <p className={styles.sessionError} role="alert">{t(sessionError)}</p>}
              <div className={styles.accountActions}>
                <Link href="/sell">{t("auth.createAuction")} <span aria-hidden="true">↗</span></Link>
                <Link href="/manage">{t("common.manageAuctions")}</Link>
                <Link href="/">{t("auth.explore")}</Link>
              </div>
              <button className={styles.signOut} type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
                {t(signingOut ? "auth.signingOut" : "auth.signOut")}
              </button>
            </div>
          ) : (
            <>
              {(sessionError || emailConfirmed) && (
                <p className={sessionError ? styles.sessionError : styles.confirmedMessage} role={sessionError ? "alert" : "status"}>
                  {t(sessionError ?? "auth.confirmed")}
                </p>
              )}
              <AuthForm
                initialMode={initialMode}
                ready={ready}
                oauthRedirectPath={nextPath ? "/auth?next=/manage" : "/auth"}
                emailRedirectPath={nextPath ? "/auth?next=/manage" : "/auth"}
                onAuthenticated={handleAuthenticated}
              />
              <p className={styles.legalLine}>
                {t("auth.legal").split(/(\{terms\}|\{privacy\})/).map((part, index) =>
                  part === "{terms}" ? <Link key={index} href="/terms">{t("common.terms")}</Link>
                    : part === "{privacy}" ? <Link key={index} href="/privacy">{t("common.privacy")}</Link>
                      : part,
                )}
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
