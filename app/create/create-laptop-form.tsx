"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import { PreferenceControls } from "@/app/preference-controls";
import {
  amountFromUsd,
  amountToUsd,
  amountToUsdCents,
  currencyDisplayName,
  currencySymbol,
  formatMoney,
  minimumDisplayAmount,
  type Currency,
} from "@/lib/money";

import styles from "./create.module.css";

const PREVIEW_SPOTS = [
  { id: 1, size: "L" },
  { id: 2, size: "L" },
  { id: 3, size: "L" },
  { id: 4, size: "S" },
  { id: 5, size: "S" },
  { id: 6, size: "S" },
  { id: 7, size: "S" },
  { id: 8, size: "M" },
  { id: 9, size: "M" },
  { id: 10, size: "M" },
] as const;

type CreateResponse = {
  error?: string;
  location?: string;
  result?: { reason: string; slug: string };
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function defaultAuctionEnd() {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function positiveAmount(value: string, fallback: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

export function CreateLaptopForm() {
  const { currency, locale, t } = useI18n();
  const [title, setTitle] = useState(() => t("create.defaultTitle"));
  const [tagline, setTagline] = useState(() => t("create.defaultTagline"));
  const [laptopModel, setLaptopModel] = useState("MacBook Pro 14-inch");
  const [slug, setSlug] = useState("my-travelling-laptop");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [smallBid, setSmallBid] = useState(() => String(minimumDisplayAmount(125, currency)));
  const [mediumBid, setMediumBid] = useState(() => String(minimumDisplayAmount(200, currency)));
  const [largeBid, setLargeBid] = useState(() => String(minimumDisplayAmount(400, currency)));
  const [goal, setGoal] = useState(() => String(minimumDisplayAmount(3200, currency)));
  const [minIncrement, setMinIncrement] = useState(() => String(minimumDisplayAmount(10, currency)));
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [auctionEnd, setAuctionEnd] = useState(defaultAuctionEnd);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdLocation, setCreatedLocation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const previousCurrency = useRef<Currency>(currency);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    const previous = previousCurrency.current;
    if (previous === currency) return;
    const convert = (value: string) => String(Math.round(amountFromUsd(amountToUsd(Number(value) || 0, previous), currency)));
    setSmallBid(convert);
    setMediumBid(convert);
    setLargeBid(convert);
    setGoal(convert);
    setMinIncrement(convert);
    previousCurrency.current = currency;
  }, [currency]);

  const prices = useMemo(() => ({
    S: positiveAmount(smallBid, minimumDisplayAmount(125, currency)),
    M: positiveAmount(mediumBid, minimumDisplayAmount(200, currency)),
    L: positiveAmount(largeBid, minimumDisplayAmount(400, currency)),
  }), [currency, largeBid, mediumBid, smallBid]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugWasEdited) setSlug(slugify(value));
  };

  const handlePhotoChange = (file: File | undefined) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);
    formData.set("slug", slug);
    formData.set("title", title);
    formData.set("tagline", tagline);
    formData.set("laptopModel", laptopModel);
    formData.set("goalCents", String(amountToUsdCents(Number(goal), currency)));
    formData.set("smallOpeningBidCents", String(amountToUsdCents(prices.S, currency)));
    formData.set("mediumOpeningBidCents", String(amountToUsdCents(prices.M, currency)));
    formData.set("largeOpeningBidCents", String(amountToUsdCents(prices.L, currency)));
    formData.set("minIncrementCents", String(amountToUsdCents(Number(minIncrement), currency)));
    formData.set("auctionClosesAt", new Date(auctionEnd).toISOString());
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch("/api/laptops", { method: "POST", body: formData });
      const payload = await response.json() as CreateResponse;
      if (!response.ok || !payload.location) {
        setErrorMessage(t("create.error"));
        if (payload.result?.reason === "idempotency_conflict") {
          setIdempotencyKey(crypto.randomUUID());
        }
        return;
      }
      setCreatedLocation(payload.location);
    } catch {
      setErrorMessage(t("create.networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (createdLocation) {
    return (
      <main className={styles.successPage}>
        <PreferenceControls className={styles.successPreferences} />
        <div className={styles.successMark} aria-hidden="true">✓</div>
        <p className={styles.eyebrow}>{t("create.published")}</p>
        <h1>{t("create.successTitle")}</h1>
        <p>{t("create.successBody")}</p>
        <div className={styles.successActions}>
          <Link className={styles.primaryAction} href={createdLocation}>{t("create.openPublic")}</Link>
          <Link className={styles.secondaryAction} href="/">{t("create.back")}</Link>
        </div>
        <code>{typeof window === "undefined" ? createdLocation : `${window.location.origin}${createdLocation}`}</code>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>Brand Anything</Link>
        <span>{t("common.listLaptop")}</span>
        <div className={styles.topbarActions}>
          <PreferenceControls />
          <Link href="/" className={styles.backLink}>{t("create.viewExample")}</Link>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.formSide} aria-labelledby="create-title">
          <div className={styles.formIntro}>
            <p className={styles.eyebrow}>{t("create.eyebrow")}</p>
            <h1 id="create-title">{t("create.title")}</h1>
            <p>{t("create.intro")}</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <fieldset>
              <legend><span>01</span> {t("create.campaign")}</legend>
              <label>
                {t("create.publicTitle")}
                <input name="titlePreview" value={title} onChange={(event) => handleTitleChange(event.target.value)} minLength={3} maxLength={80} required />
              </label>
              <label>
                {t("create.promise")}
                <input name="taglinePreview" value={tagline} onChange={(event) => setTagline(event.target.value)} minLength={3} maxLength={160} required />
              </label>
              <label>
                {t("create.publicUrl")}
                <span className={styles.slugInput}><b>/laptop/</b><input value={slug} onChange={(event) => {
                  setSlugWasEdited(true);
                  setSlug(slugify(event.target.value));
                }} minLength={3} maxLength={48} required /></span>
              </label>
              <label>
                {t("create.story")}
                <textarea name="story" rows={5} minLength={20} maxLength={1200} defaultValue={t("create.defaultStory")} required />
              </label>
            </fieldset>

            <fieldset>
              <legend><span>02</span> {t("create.laptop")}</legend>
              <label>
                {t("create.model")}
                <input name="laptopModelPreview" value={laptopModel} onChange={(event) => setLaptopModel(event.target.value)} minLength={2} maxLength={100} required />
              </label>
              <label className={styles.fileField}>
                {t("create.photo")} <em>{t("common.optional")}</em>
                <input name="photo" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => handlePhotoChange(event.target.files?.[0])} />
                <span>{photoPreview ? t("create.photoReady") : t("create.photoChoose")}</span>
              </label>
            </fieldset>

            <fieldset>
              <legend><span>03</span> {t("create.auction")}</legend>
              <div className={styles.priceGrid}>
                <label>{t("create.smallSpots")} ({currencySymbol(currency)})<input type="number" min={minimumDisplayAmount(10, currency)} max={minimumDisplayAmount(100000, currency)} value={smallBid} onChange={(event) => setSmallBid(event.target.value)} required /></label>
                <label>{t("create.mediumSpots")} ({currencySymbol(currency)})<input type="number" min={minimumDisplayAmount(10, currency)} max={minimumDisplayAmount(100000, currency)} value={mediumBid} onChange={(event) => setMediumBid(event.target.value)} required /></label>
                <label>{t("create.largeSpots")} ({currencySymbol(currency)})<input type="number" min={minimumDisplayAmount(10, currency)} max={minimumDisplayAmount(100000, currency)} value={largeBid} onChange={(event) => setLargeBid(event.target.value)} required /></label>
              </div>
              <div className={styles.priceGrid}>
                <label>{t("create.goal")} ({currencySymbol(currency)})<input type="number" min={minimumDisplayAmount(100, currency)} max={minimumDisplayAmount(1000000, currency)} value={goal} onChange={(event) => setGoal(event.target.value)} required /></label>
                <label>{t("create.minimumRaise")} ({currencySymbol(currency)})<input type="number" min={minimumDisplayAmount(1, currency)} max={minimumDisplayAmount(10000, currency)} value={minIncrement} onChange={(event) => setMinIncrement(event.target.value)} required /></label>
                <label>{t("create.ends")}<input type="datetime-local" value={auctionEnd} onChange={(event) => setAuctionEnd(event.target.value)} required /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend><span>04</span> {t("create.owner")}</legend>
              <div className={styles.ownerGrid}>
                <label>{t("create.publicName")}<input name="ownerName" type="text" minLength={2} maxLength={80} placeholder="Tao" required /></label>
                <label>{t("create.privateEmail")}<input name="ownerEmail" type="email" maxLength={254} placeholder="you@company.com" required /></label>
              </div>
              <p className={styles.privateNote}>{t("create.privateNote")}</p>
            </fieldset>

            {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
            <button className={styles.publishButton} type="submit" disabled={submitting || !auctionEnd}>
              {submitting ? t("create.publishing") : t("create.publish")}
            </button>
            <p className={styles.legal}>{t("create.legal")}</p>
          </form>
        </section>

        <aside className={styles.previewSide} aria-label={t("create.previewAria")}>
          <div className={styles.previewSticky}>
            <div className={styles.previewMeta}>
              <span>{t("create.livePreview")}</span>
              <span>{t("create.tenSpots")}</span>
            </div>
            <div className={styles.previewCopy}>
              <p>brandanything.app/laptop/{slug || t("create.yourUrl")}</p>
              <h2>{title || t("create.yourLaptop")}</h2>
              <p>{tagline || t("create.promisePlaceholder")}</p>
            </div>
            <div className={styles.laptopStage}>
              <div
                className={`${styles.laptopLid} ${photoPreview ? styles.laptopLidWithPhoto : ""}`}
                style={photoPreview ? { backgroundImage: `linear-gradient(oklch(20% 0.01 250 / 0.3), oklch(20% 0.01 250 / 0.3)), url(${photoPreview})` } : undefined}
              >
                <span className={styles.apple} aria-hidden="true"></span>
                {PREVIEW_SPOTS.map((spot) => (
                  <span className={`${styles.previewSpot} ${styles[`spot${spot.id}`]}`} key={spot.id}>
                    <b>{spot.id}</b>
                    <small>{formatMoney(amountToUsd(prices[spot.size], currency), currency, locale, 0)}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.previewFooter}>
              <span>{laptopModel || t("create.modelPlaceholder")}</span>
              <span>{t("create.currencyAuction", { currency: currencyDisplayName(currency) })}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
