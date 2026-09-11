"use client";

import type { Session } from "@supabase/supabase-js";
import { useId, useRef, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import type { TranslationKey } from "@/lib/i18n";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import styles from "./auth-form.module.css";

const EMAIL_SEND_COOLDOWN_STORAGE_KEY = "brand-anything-email-send-cooldown";
const EMAIL_SEND_COOLDOWN_MS = 5 * 60 * 1000;

type AuthMessage = { key: TranslationKey; values?: Record<string, string | number> };

type EmailSendCooldown = {
  email: string;
  sentAt: number;
};

export type AuthMode = "sign-in" | "sign-up";
type OAuthProvider = "x" | "github";

type AuthFormProps = {
  initialMode?: AuthMode;
  context?: "account" | "publish";
  embedded?: boolean;
  ready?: boolean;
  disabled?: boolean;
  eyebrow?: string;
  title?: string;
  description?: string;
  note?: string;
  emailRedirectPath?: string;
  oauthRedirectPath?: string;
  onAuthenticated?: (session: Session) => void;
  onBeforeOAuth?: (provider: OAuthProvider) => void;
};

function readEmailSendCooldown(): EmailSendCooldown | null {
  try {
    const value = window.localStorage.getItem(EMAIL_SEND_COOLDOWN_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<EmailSendCooldown>;
    if (typeof parsed.email !== "string" || typeof parsed.sentAt !== "number") return null;
    if (Date.now() - parsed.sentAt >= EMAIL_SEND_COOLDOWN_MS) {
      window.localStorage.removeItem(EMAIL_SEND_COOLDOWN_STORAGE_KEY);
      return null;
    }
    return { email: parsed.email, sentAt: parsed.sentAt };
  } catch {
    return null;
  }
}

function rememberEmailSent(email: string) {
  try {
    window.localStorage.setItem(EMAIL_SEND_COOLDOWN_STORAGE_KEY, JSON.stringify({
      email,
      sentAt: Date.now(),
    } satisfies EmailSendCooldown));
  } catch {
    // Supabase also enforces its configured cooldown when storage is unavailable.
  }
}

function authErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "";
}

function emailErrorKey(code: string): TranslationKey {
  switch (code) {
    case "invalid_credentials": return "auth.invalidCredentials";
    case "user_already_exists":
    case "email_exists": return "auth.exists";
    case "weak_password": return "auth.weakPassword";
    case "over_request_rate_limit": return "auth.rateLimit";
    case "signup_disabled": return "auth.signupDisabled";
    default: return "auth.failed";
  }
}

function providerName(provider: OAuthProvider) {
  return provider === "x" ? "X" : "GitHub";
}

function providerIcon(provider: OAuthProvider) {
  if (provider === "x") return <span className={styles.xIcon} aria-hidden="true">𝕏</span>;
  return (
    <svg className={styles.githubIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .7a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.1c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.45 11.45 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.6-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .7Z" />
    </svg>
  );
}

export function AuthForm({
  initialMode = "sign-up",
  context = "account",
  embedded = false,
  ready = true,
  disabled = false,
  eyebrow,
  title,
  description,
  note,
  emailRedirectPath = "/auth?mode=sign-in&confirmed=1",
  oauthRedirectPath = "/auth",
  onAuthenticated,
  onBeforeOAuth,
}: AuthFormProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState<OAuthProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<AuthMessage | null>(null);
  const [feedback, setFeedback] = useState<AuthMessage | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replace(/:/g, "");
  const titleId = `auth-title-${generatedId}`;
  const configured = isSupabaseBrowserConfigured();
  const busy = submitting || providerBusy !== null;
  const controlsDisabled = disabled || busy || !ready || !configured;

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage(null);
    setFeedback(null);
    setShowPassword(false);
  };

  const prepareEmailSignIn = (registeredEmail: string) => {
    setMode("sign-in");
    setEmail(registeredEmail);
    setPassword("");
    setShowPassword(false);
    window.requestAnimationFrame(() => passwordRef.current?.focus());
  };

  const handleEmailAuth = async () => {
    if (controlsDisabled) return;
    const normalizedEmail = email.trim().toLowerCase();
    const minimumPasswordLength = mode === "sign-up" ? 8 : 6;
    setErrorMessage(null);
    setFeedback(null);

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMessage({ key: "auth.invalidEmail" });
      return;
    }
    if (password.length < minimumPasswordLength) {
      setErrorMessage({ key: "auth.shortPassword", values: { minimum: minimumPasswordLength } });
      return;
    }

    if (mode === "sign-up") {
      const cooldown = readEmailSendCooldown();
      if (cooldown) {
        const remainingMinutes = Math.max(1, Math.ceil(
          (EMAIL_SEND_COOLDOWN_MS - (Date.now() - cooldown.sentAt)) / 60_000,
        ));
        if (cooldown.email === normalizedEmail) {
          prepareEmailSignIn(normalizedEmail);
          setErrorMessage({ key: "auth.emailCooldown", values: { minutes: remainingMinutes } });
        } else {
          setErrorMessage({ key: "auth.browserCooldown", values: { minutes: remainingMinutes } });
        }
        return;
      }
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowser();
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: new URL(emailRedirectPath, window.location.origin).toString(),
          },
        });
        if (error) throw error;
        if (!data.user || data.user.identities?.length === 0) {
          prepareEmailSignIn(normalizedEmail);
          setErrorMessage({ key: "auth.exists" });
          return;
        }

        rememberEmailSent(normalizedEmail);
        if (data.session) {
          setFeedback({ key: context === "publish" ? "auth.createdPublish" : "auth.createdSignedIn" });
          onAuthenticated?.(data.session);
        } else {
          prepareEmailSignIn(normalizedEmail);
          setFeedback({ key: "auth.confirmSent", values: { email: normalizedEmail } });
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        setFeedback({ key: context === "publish" ? "auth.signedInPublish" : "auth.signedIn" });
        onAuthenticated?.(data.session);
      }
    } catch (error) {
      const code = authErrorCode(error);
      if (code === "email_not_confirmed") {
        setErrorMessage({ key: "auth.confirmRequired" });
      } else if (code === "over_email_send_rate_limit") {
        rememberEmailSent(normalizedEmail);
        prepareEmailSignIn(normalizedEmail);
        setErrorMessage({ key: "auth.emailRateLimit" });
      } else {
        setErrorMessage({ key: emailErrorKey(code) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    if (controlsDisabled) return;
    setErrorMessage(null);
    setFeedback(null);
    setProviderBusy(provider);
    onBeforeOAuth?.(provider);

    try {
      const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: new URL(oauthRedirectPath, window.location.origin).toString(),
        },
      });
      if (error) throw error;
    } catch {
      setProviderBusy(null);
      setErrorMessage({ key: "auth.oauthFailed", values: { provider: providerName(provider) } });
    }
  };

  const content = (
    <>
      <div className={styles.heading}>
        <p>{eyebrow ?? t(context === "publish" ? "auth.publishEyebrow" : "auth.eyebrow")}</p>
        <h2 id={titleId}>{title ?? t(context === "publish" ? "auth.publishTitle" : "auth.title")}</h2>
        <span>{description ?? t(context === "publish" ? "auth.publishDescription" : "auth.description")}</span>
      </div>

      <div className={styles.modeTabs} role="tablist" aria-label={t("auth.emailAuth")}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-up"}
          className={mode === "sign-up" ? styles.activeMode : ""}
          onClick={() => changeMode("sign-up")}
        >
          {t("auth.create")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-in"}
          className={mode === "sign-in" ? styles.activeMode : ""}
          onClick={() => changeMode("sign-in")}
        >
          {t("auth.signIn")}
        </button>
      </div>

      <div className={styles.fields}>
        <label htmlFor={`auth-email-${generatedId}`}>
          {t("common.email")}
          <input
            id={`auth-email-${generatedId}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            disabled={controlsDisabled}
            required
          />
        </label>
        <label htmlFor={`auth-password-${generatedId}`}>
          {t("auth.password")}
          <span className={styles.passwordField}>
            <input
              ref={passwordRef}
              id={`auth-password-${generatedId}`}
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              minLength={mode === "sign-up" ? 8 : 6}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t(mode === "sign-up" ? "auth.passwordHint" : "auth.yourPassword")}
              disabled={controlsDisabled}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
              disabled={controlsDisabled}
            >
              {t(showPassword ? "auth.hide" : "auth.show")}
            </button>
          </span>
        </label>
      </div>

      {!configured && (
        <p className={styles.error} role="alert">{t("auth.unconfigured")}</p>
      )}
      {errorMessage && <p className={styles.error} role="alert">{t(errorMessage.key, errorMessage.values)}</p>}
      {feedback && <p className={styles.feedback} role="status">{t(feedback.key, feedback.values)}</p>}

      <button
        type={embedded ? "button" : "submit"}
        className={styles.emailButton}
        disabled={controlsDisabled}
        onClick={embedded ? () => void handleEmailAuth() : undefined}
      >
        {t(submitting
          ? mode === "sign-up" ? "auth.creating" : "auth.signingIn"
          : mode === "sign-up"
            ? context === "publish" ? "auth.createPublish" : "auth.create"
            : context === "publish" ? "auth.signInPublish" : "auth.signIn")}
      </button>

      <div className={styles.divider}><span>{t("auth.continueWith")}</span></div>
      <div className={styles.providerGrid}>
        {(["x", "github"] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            className={styles.providerButton}
            disabled={controlsDisabled}
            onClick={() => void handleOAuth(provider)}
          >
            {providerIcon(provider)}
            <span>{providerBusy === provider ? t("auth.opening") : providerName(provider)}</span>
          </button>
        ))}
      </div>

      <p className={styles.note}>{note ?? t(context === "publish" ? "auth.publishNote" : "auth.note")}</p>
    </>
  );

  if (embedded) {
    return (
      <section
        className={`${styles.panel} ${styles.embedded}`}
        aria-labelledby={titleId}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
          event.preventDefault();
          void handleEmailAuth();
        }}
      >
        {content}
      </section>
    );
  }

  return (
    <form
      noValidate
      className={`${styles.panel} ${styles.standalone}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void handleEmailAuth();
      }}
    >
      {content}
    </form>
  );
}
