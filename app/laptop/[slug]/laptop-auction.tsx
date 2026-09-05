/* eslint-disable @next/next/no-img-element */
"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import { ModelStage } from "@/app/model-stage";
import { PreferenceControls } from "@/app/preference-controls";
import type { Spot } from "@/lib/auction";
import { getBrandModelFormat } from "@/lib/brand-model";
import { formatRelativeTime, SPOT_NAME_KEYS } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import type { AuctionBidResult, AuctionCampaignSnapshot } from "@/lib/campaign-auction";
import {
  amountFromUsd,
  amountToUsd,
  amountToUsdCents,
  currencyDisplayName,
  currencySymbol,
  formatMoney as formatCurrency,
  minimumDisplayAmount,
} from "@/lib/money";
import type { Currency } from "@/lib/money";

import styles from "./laptop.module.css";

function compactMoney(amountUsd: number, currency: Currency, locale: Locale) {
  const converted = amountFromUsd(amountUsd, currency);
  const rounded = Math.round(converted);
  const sym = currencySymbol(currency);
  if (rounded >= 1_000_000) {
    const m = rounded / 1_000_000;
    return `${sym}${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (rounded >= 10_000) {
    const k = rounded / 1_000;
    return `${sym}${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return formatCurrency(amountUsd, currency, locale, 0);
}

type BidResponse = {
  error?: string;
  result?: AuctionBidResult;
  snapshot?: AuctionCampaignSnapshot | null;
};

function useCountdown(closesAt: string) {
  const { t } = useI18n();
  const calculate = useCallback(() => {
    const left = Math.max(0, new Date(closesAt).getTime() - Date.now());
    if (left === 0) return t("laptop.closed");
    const days = Math.floor(left / 86_400_000);
    const hours = Math.floor((left % 86_400_000) / 3_600_000);
    const minutes = Math.floor((left % 3_600_000) / 60_000);
    return t("laptop.countdown", { days, hours, minutes });
  }, [closesAt, t]);
  const [countdown, setCountdown] = useState(calculate);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(calculate()), 30_000);
    return () => window.clearInterval(timer);
  }, [calculate]);
  return countdown;
}

function LaptopLid({ spots, onSelect }: { spots: Spot[]; onSelect: (spot: Spot) => void }) {
  const { currency, locale, t } = useI18n();
  const money = (amount: number) => formatCurrency(amount, currency, locale, 0);
  const compact = (amount: number) => compactMoney(amount, currency, locale);

  return (
    <div className="lid-stage" aria-label={t("laptop.layoutAria")}>
      <div className="mac-lid">
        <div className="lid-camera" />
        <Image className="apple-mark" src="/apple-logo.svg" alt={t("common.appleLogo")} width={160} height={160} />
        {spots.map((spot) => {
          const hasBid = spot.bids > 0;
          return (
            <button
              className={`lid-spot lid-spot--${spot.id} ${hasBid ? "" : "lid-spot--available"}`}
              key={spot.id}
              onClick={() => onSelect(spot)}
              aria-label={hasBid
                ? t("laptop.heldSpotAria", { id: spot.id, holder: spot.holder, amount: money(spot.bid) })
                : t("laptop.openSpotAria", { id: spot.id, amount: money(spot.minBid) })}
            >
              {spot.logo ? (
                <span className="brand-logo"><img src={spot.logo} alt={spot.holder} /></span>
              ) : (
                <span className="lid-spot-number">{spot.id}</span>
              )}
              <span className="lid-holder">{hasBid ? spot.holder : t("common.available")}</span>
              <span className="lid-price">{hasBid ? compact(spot.bid) : t("common.starts", { amount: compact(spot.minBid) })}</span>
              <span className="lid-outbid">{hasBid ? t("common.outbid") : t("common.placeBid")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BidPanel({
  slug,
  spot,
  isAnything,
  onSnapshot,
}: {
  slug: string;
  spot: Spot;
  isAnything: boolean;
  onSnapshot: (snapshot: AuctionCampaignSnapshot) => void;
}) {
  const { currency, locale, t } = useI18n();
  const money = (amountUsd: number) => formatCurrency(amountUsd, currency, locale, 0);
  const [amount, setAmount] = useState(String(minimumDisplayAmount(spot.minBid, currency)));
  const [logoName, setLogoName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    const formData = new FormData(event.currentTarget);
    formData.set("spotId", String(spot.id));
    formData.set("amountCents", String(amountToUsdCents(Number(amount), currency)));
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch(`/api/auctions/${encodeURIComponent(slug)}/bids`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as BidResponse;
      if (payload.snapshot) onSnapshot(payload.snapshot);
      if (!response.ok || !payload.result?.accepted) {
        setErrorMessage(t("home.bidError"));
        if (response.status === 409) {
          setIdempotencyKey(crypto.randomUUID());
          if (payload.result?.minimumNextBid) setAmount(String(minimumDisplayAmount(payload.result.minimumNextBid, currency)));
        }
        return;
      }
      setSuccessMessage(payload.result.reason === "already_processed"
        ? t("laptop.alreadyRecorded", { amount: money(amountToUsd(Number(amount), currency)), spot: spot.id })
        : t("laptop.leading", { amount: money(payload.result.currentBid), spot: spot.id }));
    } catch {
      setErrorMessage(t("home.networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <div className={styles.bidSuccess} role="status">
        <span aria-hidden="true">✓</span>
        <h3>{t("home.bidLive")}</h3>
        <p>{successMessage}</p>
      </div>
    );
  }

  return (
    <form className={styles.bidForm} onSubmit={handleSubmit}>
      <div className={styles.bidHeading}>
        <p>{t("common.spot")} {spot.id} · {spot.size}</p>
        <h3>{isAnything ? spot.name : SPOT_NAME_KEYS[spot.id] ? t(SPOT_NAME_KEYS[spot.id]!) : spot.name}</h3>
        <span>{spot.bids > 0 ? t("laptop.leadingLine", { holder: spot.holder, amount: money(spot.bid) }) : `${t("common.openingBid")} ${money(spot.minBid)}`}</span>
      </div>
      <label>{t("laptop.yourBid", { currency: currencyDisplayName(currency) })}<input type="number" min={minimumDisplayAmount(spot.minBid, currency)} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <div className={styles.fieldPair}>
        <label>{t("common.brandName")}<input name="brandName" type="text" maxLength={80} placeholder={t("common.brand")} required /></label>
        <label>{t("common.email")}<input name="email" type="email" maxLength={254} placeholder="you@company.com" required /></label>
      </div>
      <div className={styles.fieldPair}>
        <label>{t("common.website")} <em>{t("common.optional")}</em><input name="website" type="url" maxLength={2048} placeholder="https://yourbrand.com" /></label>
        <label>{t("common.xHandle")} <em>{t("common.optional")}</em><input name="xHandle" type="text" maxLength={50} placeholder="@yourbrand" /></label>
      </div>
      <label className={styles.logoUpload}>
        {t("common.logo")} <em>{t("common.optional")}</em>
        <input name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} />
        <span>{logoName || t("laptop.chooseLogo")}</span>
      </label>
      {errorMessage && <p className={styles.bidError} role="alert">{errorMessage}</p>}
      <button type="submit" disabled={submitting}>{submitting ? t("home.savingBid") : spot.bids > 0 ? `${t("common.outbid")} ${spot.holder} →` : `${t("common.placeFirstBid")} →`}</button>
      <small>{t(isAnything ? "laptop.bidFinalCampaign" : "laptop.bidFinal")}</small>
    </form>
  );
}

export function LaptopAuction({ initialSnapshot }: { initialSnapshot: AuctionCampaignSnapshot }) {
  const { currency, locale, t, formatDate } = useI18n();
  const money = (amount: number) => formatCurrency(amount, currency, locale, 0);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedSpotId, setSelectedSpotId] = useState(initialSnapshot.spots[0]?.id ?? 1);
  const [backendStatus, setBackendStatus] = useState<"live" | "offline">("live");
  const countdown = useCountdown(snapshot.campaign.closesAt);
  const selectedSpot = snapshot.spots.find((spot) => spot.id === selectedSpotId) ?? snapshot.spots[0];
  const totalRaised = useMemo(
    () => snapshot.spots.reduce((sum, spot) => sum + (spot.bids > 0 ? spot.bid : 0), 0),
    [snapshot.spots],
  );
  const filled = useMemo(() => snapshot.spots.filter((spot) => spot.bids > 0).length, [snapshot.spots]);
  const progress = Math.min(100, Math.round((totalRaised / snapshot.campaign.goal) * 100));
  const isAnything = snapshot.campaign.assetType === "anything";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/auctions/${encodeURIComponent(snapshot.campaign.slug)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const nextSnapshot = await response.json() as AuctionCampaignSnapshot;
      setSnapshot((current) => ({
        ...nextSnapshot,
        campaign: {
          ...nextSnapshot.campaign,
          ...(current.campaign.modelFileName === nextSnapshot.campaign.modelFileName && current.campaign.modelUrl
            ? { modelUrl: current.campaign.modelUrl }
            : {}),
        },
      }));
      setBackendStatus("live");
    } catch {
      setBackendStatus("offline");
    }
  }, [snapshot.campaign.slug]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.wordmark}>Brand Anything</Link>
        <span className={backendStatus === "live" ? styles.live : styles.offline}>{backendStatus === "live" ? t("common.liveAuction") : t("laptop.reconnecting")}</span>
        <div className={styles.navActions}>
          <PreferenceControls />
          <Link href="/sell" className={styles.createLink}>{t("common.listLaptopArrow")}</Link>
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.ownerLine}>{t(isAnything ? "laptop.byCampaignOwner" : "laptop.byOwner", { owner: snapshot.campaign.ownerName })}</p>
          <h1>{snapshot.campaign.title}</h1>
          <p>{snapshot.campaign.tagline}</p>
          <div className={styles.heroStats}>
            <span><b>{money(totalRaised)}</b> {t("home.raised")}</span>
            <span><b>{t(snapshot.spots.length === 1 ? "laptop.spotClaimed" : "laptop.spotsClaimed", { filled, count: snapshot.spots.length })}</b></span>
            <span><b>{countdown}</b></span>
          </div>
        </div>
        <div className={styles.lidWrap}>
          {isAnything && snapshot.campaign.modelUrl ? (
            <ModelStage
              sourceUrl={snapshot.campaign.modelUrl}
              format={snapshot.campaign.modelFileName ? getBrandModelFormat(snapshot.campaign.modelFileName) || undefined : undefined}
              label={t("laptop.modelAria", { object: snapshot.campaign.assetName })}
              spots={snapshot.spots.map((spot) => ({
                ...spot,
                position: spot.surfacePosition,
                normal: spot.surfaceNormal,
              }))}
              selectedSpotId={selectedSpotId}
              onSelectSpot={setSelectedSpotId}
              className={styles.modelHeroStage}
            />
          ) : (
            <LaptopLid spots={snapshot.spots} onSelect={(spot) => setSelectedSpotId(spot.id)} />
          )}
          <p>{isAnything ? t("laptop.orbitObject", { object: snapshot.campaign.assetName }) : t("laptop.tap", { model: snapshot.campaign.objectName })}</p>
        </div>
      </header>

      <section className={styles.progressSection} aria-label={t("laptop.progressAria")}>
        <div><span style={{ width: `${progress}%` }} /></div>
        <p>{t("laptop.progress", { progress, goal: money(snapshot.campaign.goal) })}</p>
      </section>

      <section className={styles.auctionSection} id="auction">
        <div className={styles.auctionIntro}>
          <p>{t(isAnything && snapshot.spots.length === 1 ? "laptop.anythingPlacement" : isAnything ? "laptop.anythingPlacements" : "laptop.tenPlacements", { count: snapshot.spots.length })}</p>
          <h2>{t(isAnything ? "laptop.chooseOnObject" : "laptop.chooseWhere")}</h2>
        </div>
        <div className={styles.auctionGrid}>
          <div className={styles.spotList}>
            {snapshot.spots.map((spot) => (
              <button
                className={spot.id === selectedSpot?.id ? styles.selectedSpot : ""}
                key={spot.id}
                onClick={() => setSelectedSpotId(spot.id)}
              >
                <span>{String(spot.id).padStart(2, "0")}</span>
                <p><b>{isAnything ? spot.name : SPOT_NAME_KEYS[spot.id] ? t(SPOT_NAME_KEYS[spot.id]!) : spot.name}</b><small>{spot.size} · {spot.dimensions}</small></p>
                <strong>{compactMoney(spot.bids > 0 ? spot.bid : spot.minBid, currency, locale)}<small>{spot.bids > 0 ? `${spot.bids} ${t("common.bids")}` : t("laptop.opening")}</small></strong>
              </button>
            ))}
          </div>
          <div className={styles.bidColumn}>
            {selectedSpot && (
              <BidPanel
                key={`${selectedSpot.id}-${currency}`}
                slug={snapshot.campaign.slug}
                spot={selectedSpot}
                isAnything={isAnything}
                onSnapshot={setSnapshot}
              />
            )}
          </div>
        </div>
      </section>

      <section className={styles.storySection}>
        <div>
          <p>{t(isAnything ? "laptop.whyObject" : "laptop.why")}</p>
          <h2>{snapshot.campaign.story}</h2>
          <dl>
            <div><dt>{t(isAnything ? "laptop.object" : "laptop.machine")}</dt><dd>{snapshot.campaign.assetName}</dd></div>
            <div><dt>{t("laptop.owner")}</dt><dd>{snapshot.campaign.ownerName}</dd></div>
            <div><dt>{t("laptop.closes")}</dt><dd suppressHydrationWarning>{formatDate(snapshot.campaign.closesAt)}</dd></div>
          </dl>
        </div>
        <div className={styles.ownerPhoto}>
          {snapshot.campaign.photoUrl ? (
            <img src={snapshot.campaign.photoUrl} alt={t("laptop.photoAlt", { owner: snapshot.campaign.ownerName, model: snapshot.campaign.objectName })} />
          ) : (
            <div>
              {isAnything
                ? <span aria-hidden="true">✣</span>
                : <Image className={styles.ownerApple} src="/apple-logo.svg" alt="" width={96} height={96} />}
              <p>{snapshot.campaign.assetName}</p>
            </div>
          )}
        </div>
      </section>

      <section className={styles.historySection}>
        <div className={styles.historyHead}><h2>{t("laptop.bidHistory")}</h2><span>{t("laptop.recent", { count: snapshot.history.length })}</span></div>
        {snapshot.history.length > 0 ? snapshot.history.map((bid) => (
          <div className={styles.historyRow} key={bid.id}>
            <span>{bid.brand.charAt(0).toUpperCase()}</span>
            <p><b>{bid.brand}</b><small>{t("common.spot")} {bid.spot} · {formatRelativeTime(locale, bid.createdAt)}</small></p>
            <strong>{money(bid.amount)}</strong>
          </div>
        )) : (
          <div className={styles.emptyHistory}>
            <b>{t("laptop.firstStory")}</b>
            <p>{t("laptop.noPlaceholder")}</p>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <p>{t(isAnything ? "laptop.anythingFooter" : "laptop.wantPage")}</p>
        <Link href="/sell">{t("common.listLaptopArrow")}</Link>
      </footer>
    </main>
  );
}
