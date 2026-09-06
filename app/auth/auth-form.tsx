"use client";

import type { Session } from "@supabase/supabase-js";
import { useId, useRef, useState } from "react";

import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import styles from "./auth-form.module.css";

const EMAIL_SEND_COOLDOWN_STORAGE_KEY = "brand-anything-email-send-cooldown";
const EMAIL_SEND_COOLDOWN_MS = 5 * 60 * 1000;

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
  eyebrow = context === "publish" ? "One last step" : "Your account",
  title = context === "publish" ? "Sign in to publish." : "Make your mark.",
  description = context === "publish"
    ? "Your auction draft is saved while you authenticate."
    : "Create one account for every Brand Anything auction.",
  note = "Credentials are handled by Supabase Auth and are never sent to Brand Anything.",
  emailRedirectPath = "/auth?mode=sign-in&confirmed=1",
  oauthRedirectPath = "/auth",
  onAuthenticated,
  onBeforeOAuth,
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState<OAuthProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replace(/:/g, "");
  const titleId = `auth-title-${generatedId}`;
  const configured = isSupabaseBrowserConfigured();
  const busy = submitting || providerBusy !== null;
  const controlsDisabled = disabled || busy || !ready || !configured;

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage("");
    setFeedback("");
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
    setErrorMessage("");
    setFeedback("");

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }
    if (password.length < minimumPasswordLength) {
      setErrorMessage(`Use at least ${minimumPasswordLength} characters for your password.`);
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
          setErrorMessage(`This email is already registered. Confirm the email we sent, then enter your password to sign in. You can request another email in ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`);
        } else {
          setErrorMessage(`This browser requested a confirmation email recently. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`);
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
          setErrorMessage("This email is already registered. Enter your password to sign in.");
          return;
        }

        rememberEmailSent(normalizedEmail);
        if (data.session) {
          setFeedback(context === "publish" ? "Account created. Publishing your auction…" : "Account created. You are signed in.");
          onAuthenticated?.(data.session);
        } else {
          prepareEmailSignIn(normalizedEmail);
          setFeedback(`Account created. We sent a confirmation link to ${normalizedEmail}. Confirm your email, then return here and enter your password to sign in.`);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        setFeedback(context === "publish" ? "Signed in. Publishing your auction…" : "Signed in successfully.");
        onAuthenticated?.(data.session);
      }
    } catch (error) {
      const code = authErrorCode(error);
      if (code === "email_not_confirmed") {
        setErrorMessage("Confirm your email before signing in. Check your inbox, then try again.");
      } else if (code === "over_email_send_rate_limit") {
        rememberEmailSent(normalizedEmail);
        prepareEmailSignIn(normalizedEmail);
        setErrorMessage("This email is already registered, and a confirmation email was sent recently. Confirm your email, then enter your password to sign in.");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Email authentication failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    if (controlsDisabled) return;
    setErrorMessage("");
    setFeedback("");
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
    } catch (error) {
      setProviderBusy(null);
      setErrorMessage(error instanceof Error
        ? error.message
        : `${providerName(provider)} sign-in could not be started.`);
    }
  };

  const content = (
    <>
      <div className={styles.heading}>
        <p>{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <span>{description}</span>
      </div>

      <div className={styles.modeTabs} role="tablist" aria-label="Email authentication">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-up"}
          className={mode === "sign-up" ? styles.activeMode : ""}
          onClick={() => changeMode("sign-up")}
        >
          Create account
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-in"}
          className={mode === "sign-in" ? styles.activeMode : ""}
          onClick={() => changeMode("sign-in")}
        >
          Sign in
        </button>
      </div>

      <div className={styles.fields}>
        <label htmlFor={`auth-email-${generatedId}`}>
          Email
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
          Password
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
              placeholder={mode === "sign-up" ? "At least 8 characters" : "Your password"}
              disabled={controlsDisabled}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              disabled={controlsDisabled}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
      </div>

      {!configured && (
        <p className={styles.error} role="alert">Authentication is not configured for this environment.</p>
      )}
      {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
      {feedback && <p className={styles.feedback} role="status">{feedback}</p>}

      <button
        type={embedded ? "button" : "submit"}
        className={styles.emailButton}
        disabled={controlsDisabled}
        onClick={embedded ? () => void handleEmailAuth() : undefined}
      >
        {submitting
          ? mode === "sign-up" ? "Creating account…" : "Signing in…"
          : mode === "sign-up"
            ? context === "publish" ? "Create account & publish" : "Create account"
            : context === "publish" ? "Sign in & publish" : "Sign in"}
      </button>

      <div className={styles.divider}><span>or continue with</span></div>
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
            <span>{providerBusy === provider ? "Opening…" : providerName(provider)}</span>
          </button>
        ))}
      </div>

      <p className={styles.note}>{note}</p>
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
