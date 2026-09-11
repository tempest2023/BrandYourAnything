"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

import styles from "./account-nav.module.css";

function userLabel(user: User, fallback = "B") {
  return user.email
    || String(user.user_metadata.user_name || user.user_metadata.name || fallback);
}

function avatarUrl(user: User) {
  const value = user.user_metadata.avatar_url || user.user_metadata.picture;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}

function initials(user: User) {
  const label = userLabel(user).trim();
  return label.slice(0, 1).toUpperCase() || "B";
}

export function AccountNav() {
  const { t } = useI18n();
  const configured = isSupabaseBrowserConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  if (!ready) return <span className={styles.placeholder} aria-hidden="true" />;

  if (!user) {
    return (
      <Link className={styles.signUp} href="/auth?mode=sign-up">
        {t("common.signUp")}
      </Link>
    );
  }

  const image = avatarUrl(user);
  const label = userLabel(user, t("auth.accountFallback"));

  return (
    <Link className={styles.avatarLink} href="/auth" aria-label={`${t("common.account")}: ${label}`} title={label}>
      {image ? (
        // OAuth profile images are provided by the authenticated identity at runtime.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true">{initials(user)}</span>
      )}
    </Link>
  );
}
