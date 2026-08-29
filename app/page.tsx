"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import { PreferenceControls } from "@/app/preference-controls";
import {
  STARTER_HISTORY,
  STARTER_SPOTS,
  type AuctionSnapshot,
  type PlaceBidResult,
  type Spot,
} from "@/lib/auction";
import { formatRelativeTime, SPOT_NAME_KEYS } from "@/lib/i18n";
import {
  amountToUsd,
  amountToUsdCents,
  currencyDisplayName,
  currencySymbol,
  formatMoney as formatCurrency,
  minimumDisplayAmount,
} from "@/lib/money";

type LidView = "live" | "final";
type TableView = "spots" | "history";

const CAMPAIGN_GOAL_USD = 3200;
const SOURCE_URL = "https://github.com/tempest2023/BrandYourAnything";
const CREATE_URL = "/create";

function useCountdown() {
  const { t } = useI18n();
  const [remaining, setRemaining] = useState({ days: 0, hours: 0, minutes: 0, closed: false });

  useEffect(() => {
    const auctionEnd = new Date("2026-09-09T08:00:00Z").getTime();
    const update = () => {
      const left = Math.max(0, auctionEnd - Date.now());
      const days = Math.floor(left / 86_400_000);
      const hours = Math.floor((left % 86_400_000) / 3_600_000);
      const minutes = Math.floor((left % 3_600_000) / 60_000);
      setRemaining({ days, hours, minutes, closed: left === 0 });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return remaining.closed
    ? t("laptop.closed")
    : t("common.countdown", {
      days: remaining.days,
      hours: remaining.hours,
      minutes: remaining.minutes,
    });
}

function Logo({ spot, compact = false }: { spot: Spot; compact?: boolean }) {
  const { t } = useI18n();
  if (!spot.logo) return <span>{spot.holder || t("common.available")}</span>;
  return (
    <span className={`brand-logo ${compact ? "brand-logo--compact" : ""}`}>
      <Image src={spot.logo} alt={spot.holder} width={180} height={100} sizes="180px" />
    </span>
  );
}

function MacLid({ spots, onSelect }: { spots: Spot[]; onSelect: (spot: Spot) => void }) {
  const { currency, locale, t } = useI18n();
  const money = (amount: number) => formatCurrency(amount, currency, locale);

  return (
    <div className="lid-stage" aria-label={t("home.lidAria")}>
      <div className="mac-lid">
        <div className="lid-camera" />
        <span className="apple-mark" aria-label={t("common.appleLogo")}></span>
        {spots.map((spot) => {
          const hasBid = spot.bids > 0 && Boolean(spot.holder);
          const spotNameKey = SPOT_NAME_KEYS[spot.id];
          const spotName = spotNameKey ? t(spotNameKey) : spot.name;

          return (
            <button
              className={`lid-spot lid-spot--${spot.id} ${hasBid ? "" : "lid-spot--available"}`}
              key={spot.id}
              onClick={() => onSelect(spot)}
              aria-label={hasBid
                ? t("home.heldSpotAria", { id: spot.id, name: spotName, size: spot.size, holder: spot.holder, amount: money(spot.bid) })
                : t("home.openSpotAria", { id: spot.id, name: spotName, size: spot.size, amount: money(spot.minBid) })}
            >
              {hasBid ? <Logo spot={spot} /> : <span className="lid-spot-number">{spot.id}</span>}
              {(!hasBid || spot.logo) && <span className="lid-holder">{hasBid ? spot.holder : t("common.available")}</span>}
              <span className="lid-price">{hasBid ? money(spot.bid) : t("common.starts", { amount: money(spot.minBid) })}</span>
              <span className="lid-outbid">{hasBid ? t("common.outbid") : t("common.placeBid")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type BidApiResponse = {
  error?: string;
  result?: PlaceBidResult;
  snapshot?: AuctionSnapshot;
};

function BidDialog({
  spot,
  onClose,
  onSnapshot,
}: {
  spot: Spot | null;
  onClose: () => void;
  onSnapshot: (snapshot: AuctionSnapshot) => void;
}) {
  const { currency, locale, t } = useI18n();
  const money = (amountUsd: number) => formatCurrency(amountUsd, currency, locale);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const minimumDisplayBid = spot ? minimumDisplayAmount(spot.minBid, currency) : 0;
  const bidContext = `${spot?.id ?? "closed"}-${spot?.minBid ?? 0}-${currency}`;
  const [bidInput, setBidInput] = useState(() => ({ context: bidContext, value: String(minimumDisplayBid) }));
  const bid = bidInput.context === bidContext ? bidInput.value : String(minimumDisplayBid);
  const [logoName, setLogoName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [acceptedBid, setAcceptedBid] = useState<{ brand: string; amountUsd: number } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (spot && !dialog.open) dialog.showModal();
    if (!spot && dialog.open) dialog.close();
  }, [spot]);

  const amount = Number(bid) || 0;
  const amountUsd = amountToUsd(amount, currency);
  const depositUsd = amountUsd * 0.2;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!spot || submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const amountCents = amountToUsdCents(amount, currency);
    formData.set("spotId", String(spot.id));
    formData.set("amountCents", String(amountCents));
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch("/api/bids", { method: "POST", body: formData });
      const payload = await response.json() as BidApiResponse;
      if (payload.snapshot) onSnapshot(payload.snapshot);

      if (!response.ok || !payload.result?.accepted) {
        setErrorMessage(t("home.bidError"));
        if (response.status === 409) setIdempotencyKey(crypto.randomUUID());
        return;
      }

      setAcceptedBid({
        brand: String(formData.get("brandName")),
        amountUsd: amountCents / 100,
      });
      setSubmitted(true);
    } catch {
      setErrorMessage(t("home.networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="bid-dialog" onClose={onClose} onClick={(event) => {
      if (event.target === dialogRef.current) onClose();
    }}>
      {spot && (
        <div className="bid-panel">
          <button className="dialog-close" onClick={onClose} aria-label={t("common.close")}>×</button>
          {!submitted ? (
            <form onSubmit={handleSubmit}>
              <div className="bid-heading">
                <p className="eyebrow">{t("common.spot")} {spot.id}</p>
                <h3>{SPOT_NAME_KEYS[spot.id] ? t(SPOT_NAME_KEYS[spot.id]!) : spot.name}</h3>
                <p>{t("home.spotSticker", {
                  size: spot.size === "L" ? t("common.large") : spot.size === "M" ? t("common.medium") : t("common.small"),
                  dimensions: spot.dimensions,
                })}</p>
                {spot.bids > 0 ? (
                  <p className="current-bid">{t("home.currentBidLine", {
                    amount: money(spot.bid), holder: spot.holder, count: spot.bids,
                    bids: spot.bids === 1 ? t("common.bid").toLowerCase() : t("common.bids"),
                  })}</p>
                ) : (
                  <p className="current-bid">{t("home.openingBidLine", { amount: money(spot.minBid) })}</p>
                )}
              </div>

              <label htmlFor="bid">{t("home.yourBid", { currency: currencyDisplayName(currency) })}</label>
              <div className="money-input">
                <input id="bid" type="number" min={minimumDisplayBid} step="1" value={bid} onChange={(event) => setBidInput({ context: bidContext, value: event.target.value })} required />
                <span>{currencySymbol(currency)}</span>
              </div>
              <p className="field-note">{t("home.minimumBid", { amount: money(spot.minBid) })}</p>

              <div className="deposit-box">
                <p><span>{t("home.expectedDeposit", { amount: money(amountUsd) })}</span><span>{money(depositUsd)}</span></p>
                <p className="due"><span>{t("home.paymentIntegration")}</span><strong>{t("home.notCharged")}</strong></p>
                <small>{t("home.depositNote")}</small>
              </div>

              <div className="form-grid">
                <label>{t("common.brandName")}<input name="brandName" type="text" maxLength={80} placeholder="Microsoft" required /></label>
                <label>{t("common.email")}<input name="email" type="email" maxLength={254} placeholder="you@microsoft.com" required /></label>
                <label>{t("common.website")} <span>({t("common.optional")})</span><input name="website" type="url" maxLength={2048} placeholder="https://microsoft.com" /></label>
                <label>{t("common.xHandle")} <span>({t("common.optional")})</span><input name="xHandle" type="text" maxLength={50} placeholder="@microsoft" /></label>
              </div>

              <label className="upload-label" htmlFor="logo-upload">{t("common.logo")}</label>
              <label className="upload-zone" htmlFor="logo-upload">
                <input id="logo-upload" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} />
                <span className="upload-icon">⇧</span>
                <strong>{logoName || t("home.uploadLogo")}</strong>
                <small>{logoName ? t("home.logoReady") : t("home.logoFormats")}</small>
              </label>

              {errorMessage && <p className="bid-error" role="alert">{errorMessage}</p>}
              <button className="primary-button bid-submit" type="submit" disabled={submitting}>
                {submitting ? t("home.savingBid") : spot.bids > 0 ? `${t("common.outbid")} ${spot.holder}` : t("common.placeFirstBid")}
              </button>
              <p className="hand-check">{t("home.reviewNote")}</p>
            </form>
          ) : (
            <div className="bid-success" role="status">
              <span>✓</span>
              <h3>{t("home.bidLive")}</h3>
              <p>{t("home.bidLiveBody", { brand: acceptedBid?.brand ?? "", amount: money(acceptedBid?.amountUsd ?? spot.bid) })}</p>
              <button className="primary-button" onClick={onClose}>{t("home.backAuction")}</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export default function Home() {
  const { currency, locale, t } = useI18n();
  const money = (amount: number) => formatCurrency(amount, currency, locale);
  const [lidView, setLidView] = useState<LidView>("live");
  const [tableView, setTableView] = useState<TableView>("spots");
  const [spots, setSpots] = useState<Spot[]>(STARTER_SPOTS);
  const [history, setHistory] = useState(STARTER_HISTORY);
  const [backendStatus, setBackendStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [selectedSpotId, setSelectedSpotId] = useState<number | null>(null);
  const [loadedFinalAssets, setLoadedFinalAssets] = useState<Set<string>>(() => new Set());
  const [failedFinalAssets, setFailedFinalAssets] = useState<Set<string>>(() => new Set());
  const countdown = useCountdown();
  const selectedSpot = spots.find((spot) => spot.id === selectedSpotId) ?? null;
  const totalRaised = useMemo(() => spots.reduce((sum, spot) => sum + (spot.bids > 0 ? spot.bid : 0), 0), [spots]);
  const filledSpotCount = useMemo(() => spots.filter((spot) => spot.bids > 0).length, [spots]);
  const availableSpotCount = spots.length - filledSpotCount;
  const goalProgress = Math.min(100, Math.round((totalRaised / CAMPAIGN_GOAL_USD) * 100));
  const finalAssetKeys = useMemo(() => [
    "macbook:/macbook.webp",
    ...spots.filter((spot) => spot.logo).map((spot) => `logo:${spot.id}:${spot.logo}`),
  ], [spots]);
  const finalLookReady = finalAssetKeys.every((key) => loadedFinalAssets.has(key));
  const finalLookFailed = finalAssetKeys.some((key) => failedFinalAssets.has(key));

  const markFinalAssetReady = useCallback((key: string) => {
    setLoadedFinalAssets((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setFailedFinalAssets((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const markFinalAssetFailed = useCallback((key: string) => {
    setFailedFinalAssets((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const applySnapshot = useCallback((snapshot: AuctionSnapshot) => {
    setSpots(snapshot.spots);
    setHistory(snapshot.history);
    setBackendStatus("live");
  }, []);

  const refreshAuction = useCallback(async () => {
    try {
      const response = await fetch("/api/auction", { cache: "no-store" });
      if (!response.ok) throw new Error("Auction API unavailable");
      applySnapshot(await response.json() as AuctionSnapshot);
    } catch {
      setBackendStatus("offline");
    }
  }, [applySnapshot]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshAuction(), 0);
    const timer = window.setInterval(() => void refreshAuction(), 5_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refreshAuction]);

  return (
    <>
      <a className="skip-link" href="#main-content">{t("common.skip")}</a>
      <nav className="site-nav">
        <div className="nav-inner">
          <a className="wordmark" href="#top" aria-label={t("common.home")}>
            <Image src="/logo-small.png" alt="" width={41} height={41} preload />
            <span>Brand Anything</span>
          </a>
          <div className="nav-links">
            <a href="#spots">{t("common.liveAuction")}</a>
            <a href="#how">{t("common.how")}</a>
            <a href="#specs">{t("common.machine")}</a>
            <a href="#faq">{t("common.faq")}</a>
            <a href={CREATE_URL}>{t("common.listLaptop")}</a>
          </div>
          <div className="nav-actions">
            <PreferenceControls />
            <a className="dark-button" href="#spots">{t("common.getSpot")}</a>
          </div>
        </div>
      </nav>

      <main id="main-content">
        <header className="hero" id="top">
          <div className="live-visitors"><span />{t("home.auctionOpen")}</div>
          <p className="total-visits"><span>·</span>{t("home.spotsAvailable", { count: availableSpotCount })}</p>
          <h1>{t("home.heroTitle")}</h1>
          <p className="hero-subtitle">{t("home.heroSubtitle")}</p>

          <div className="funding">
            <div className="funding-row">
              <p><strong>{money(totalRaised)}</strong><span>{t("home.raised")}</span></p>
              <p>{t("home.goal", { amount: money(CAMPAIGN_GOAL_USD), progress: goalProgress })}</p>
            </div>
            <div className="progress-track"><span style={{ width: `${goalProgress}%` }} /></div>
            <p className="auction-time">{t("home.auctionEnds", { countdown })} · {filledSpotCount === 0 ? t("home.firstBrand") : t("home.stillOutbid")}</p>
            <p className={`data-status data-status--${backendStatus}`} aria-live="polite">
              <span />{backendStatus === "live" ? t("home.dbLive") : backendStatus === "connecting" ? t("home.dbConnecting") : t("home.dbOffline")}
            </p>
          </div>

          <div className="lid-view">
            <div className={`lid-layer lid-layer--live ${lidView === "live" ? "is-active" : ""}`} aria-hidden={lidView !== "live"}>
              <MacLid spots={spots} onSelect={(spot) => setSelectedSpotId(spot.id)} />
            </div>
            <div className={`lid-layer lid-layer--final ${lidView === "final" && finalLookReady ? "is-active" : ""}`} aria-hidden={lidView !== "final" || !finalLookReady}>
              <div className="final-mac">
                <Image
                  src="/macbook.webp"
                  alt={t("home.finalAlt")}
                  width={1536}
                  height={1024}
                  loading="eager"
                  fetchPriority="high"
                  sizes="(max-width: 768px) 96vw, 900px"
                  onLoad={() => markFinalAssetReady("macbook:/macbook.webp")}
                  onError={() => markFinalAssetFailed("macbook:/macbook.webp")}
                />
                {spots.map((spot) => (
                  <span className={`final-sticker final-sticker--${spot.id}`} key={spot.id} aria-hidden="true">
                    {spot.logo && (
                      <Image
                        src={spot.logo}
                        alt=""
                        width={180}
                        height={100}
                        loading="eager"
                        sizes="120px"
                        onLoad={() => markFinalAssetReady(`logo:${spot.id}:${spot.logo}`)}
                        onError={() => markFinalAssetFailed(`logo:${spot.id}:${spot.logo}`)}
                      />
                    )}
                  </span>
                ))}
              </div>
            </div>
            {lidView === "final" && !finalLookReady && (
              <div className={`final-loading ${finalLookFailed ? "final-loading--error" : ""}`} role="status" aria-live="polite">
                <span aria-hidden="true">{finalLookFailed ? "!" : ""}</span>
                <strong>{finalLookFailed ? t("home.finalLoadError") : t("home.finalPreparing")}</strong>
                <small>{finalLookFailed ? t("home.finalErrorNote") : t("home.finalLoadingNote")}</small>
                {finalLookFailed && <button type="button" onClick={() => window.location.reload()}>{t("common.reload")}</button>}
              </div>
            )}
          </div>

          <div className="segmented" role="group" aria-label={t("home.lidView")}>
            <button className={lidView === "live" ? "active" : ""} aria-pressed={lidView === "live"} onClick={() => setLidView("live")}>{t("common.liveAuction")}</button>
            <button className={lidView === "final" ? "active" : ""} aria-pressed={lidView === "final"} onClick={() => setLidView("final")}>{t("home.finalLook")}</button>
          </div>
          <p className="lid-caption">{lidView === "live" ? t("home.tapBid") : finalLookFailed ? t("home.incompleteHidden") : !finalLookReady ? t("home.appearWhenReady") : filledSpotCount === 0 ? t("home.cleanSlate") : t("home.finishedLid")}</p>

          <div className="hero-close">
            <p>{t("home.zeroPlaceholders")}</p>
            <p>{t("home.outsideWorld")}</p>
            <div>
              <a className="primary-button" href="#spots">{t("common.getSpot")}</a>
              <a className="text-link" href="#how">{t("common.how")} ›</a>
            </div>
          </div>
        </header>

        <section className="statement" aria-labelledby="statement-title">
          <div className="statement-inner">
            <div>
              <p className="statement-kicker">{t("home.recognisableLid")}</p>
              <h2 id="statement-title">{t("home.statement")}</h2>
              <a href="#spots">{t("home.seeAuction")}</a>
            </div>
            <div className="dark-mac" aria-hidden="true">
              <span className="dark-apple"></span>
              <i className="sticker-dot one" /><i className="sticker-dot two" /><i className="sticker-dot three" />
            </div>
          </div>
        </section>

        <section className="auction-section" id="spots">
          <div className="section-inner auction-inner">
            <p className="auction-status"><span />{t("home.auctionStatus", { countdown, available: availableSpotCount, total: spots.length })}</p>
            <h2>{t("home.auctionTitle")}</h2>
            <p className="section-lead">{t("home.auctionLead")}</p>
            <p className="section-copy">{t("home.auctionPrices", { small: money(125), medium: money(200), large: money(400) })}</p>

            <div className="segmented table-tabs" role="tablist" aria-label={t("home.tableView")}>
              <button role="tab" className={tableView === "spots" ? "active" : ""} aria-selected={tableView === "spots"} onClick={() => setTableView("spots")}>{t("common.spots")}</button>
              <button role="tab" className={tableView === "history" ? "active" : ""} aria-selected={tableView === "history"} onClick={() => setTableView("history")}>{t("common.history")} ({history.length})</button>
            </div>

            {tableView === "spots" ? (
              <div className="spots-table-wrap" role="region" aria-label={t("home.stickerBids")} tabIndex={0}>
                <table className="spots-table">
                  <thead><tr><th>{t("common.spot")}</th><th>{t("common.size")}</th><th>{t("common.brand")}</th><th>{t("common.bid")}</th><th><span className="sr-only">{t("common.action")}</span></th></tr></thead>
                  <tbody>
                    {spots.map((spot) => (
                      <tr key={spot.id}>
                        <td data-label={t("common.spot")}><span className="spot-number">{spot.id}</span><strong>{SPOT_NAME_KEYS[spot.id] ? t(SPOT_NAME_KEYS[spot.id]!) : spot.name}</strong></td>
                        <td data-label={t("common.size")}><span className={`size-tag size-tag--${spot.size.toLowerCase()}`}>{spot.size}</span>{spot.dimensions}</td>
                        <td data-label={t("common.brand")}>{spot.bids === 0 ? <span className="availability-pill">{t("common.available")}</span> : spot.website ? <a href={spot.website} target="_blank" rel="noreferrer"><Logo spot={spot} compact /></a> : <Logo spot={spot} compact />}</td>
                        <td data-label={spot.bids === 0 ? t("home.startingBid") : t("common.currentBid")}><strong>{money(spot.bids === 0 ? spot.minBid : spot.bid)}</strong><small>{spot.bids === 0 ? t("common.noBids") : `${spot.bids} ${spot.bids === 1 ? t("common.bid").toLowerCase() : t("common.bids")}`}</small></td>
                        <td data-label={t("common.action")}><button className="outbid-button" onClick={() => setSelectedSpotId(spot.id)}>{spot.bids === 0 ? t("common.placeBid") : t("common.outbid")}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="history-list" role="tabpanel">
                {history.length > 0 ? history.map((item) => (
                    <div className="history-row" key={item.id}>
                      <span className="history-avatar">{item.brand.charAt(0)}</span>
                      <p><strong>{item.brand}</strong> {t("home.bidOnSpot", { spot: item.spot })}<small>{formatRelativeTime(locale, item.createdAt)}</small></p>
                      <strong>{money(item.amount)}</strong>
                    </div>
                  )) : (
                    <div className="history-empty">
                      <span aria-hidden="true">01</span>
                      <strong>{t("home.firstLine")}</strong>
                      <p>{t("home.noImportedHistory")}</p>
                    </div>
                  )}
              </div>
            )}
          </div>
        </section>

        <section className="how-section" id="how">
          <div className="section-inner how-inner">
            <h2>{t("common.how")}</h2>
            <ol className="steps">
              <li><span>1</span><div><h3>{t("home.pickSpot")}</h3><p>{t("home.pickSpotBody")}</p></div></li>
              <li><span>2</span><div><h3>{t("home.winBid")}</h3><p>{t("home.winBidBody")}</p></div></li>
              <li><span>3</span><div><h3>{t("home.stickerRides")}</h3><p>{t("home.stickerRidesBody")}</p></div></li>
            </ol>
          </div>
        </section>

        <section className="specs-section" id="specs">
          <div className="section-inner specs-inner">
            <h2>{t("home.moneyTitle")}</h2>
            <p className="specs-intro">{t("home.specIntro", { amount: money(CAMPAIGN_GOAL_USD) })}</p>
            <div className="spec-card">
              <div className="spec-card-head"><h3>{t("home.specModel")}</h3><strong>{money(2529)}</strong></div>
              <dl>
                <div><dt>{t("home.specChip")}</dt><dd>{t("home.specChipValue")}</dd></div>
                <div><dt>{t("home.specMemory")}</dt><dd>{t("home.specMemoryValue")}</dd></div>
                <div><dt>{t("home.specStorage")}</dt><dd>{t("home.specStorageValue")}</dd></div>
                <div><dt>{t("home.specDisplay")}</dt><dd>{t("home.specDisplayValue")}</dd></div>
                <div><dt>{t("home.specKeyboard")}</dt><dd>{t("home.specKeyboardValue")}</dd></div>
                <div><dt>{t("home.specBox")}</dt><dd>{t("home.specBoxValue")}</dd></div>
              </dl>
            </div>
            <p className="spec-note">{t("home.priceNote")} <a href="https://www.apple.com/shop/buy-mac/macbook-pro" target="_blank" rel="noreferrer">{t("home.applePrice")}</a></p>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="section-inner faq-inner">
            <h2>{t("home.questions")}</h2>
            <div className="faq-list">
              <details><summary>{t("home.faq.real.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.real.a")}</p></div></details>
              <details><summary>{t("home.faq.why.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.why.a1")}</p><p>{t("home.faq.why.a2")}</p></div></details>
              <details><summary>{t("home.faq.get.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.get.a1")}</p><ul><li>{t("home.faq.get.li1")}</li><li>{t("home.faq.get.li2")}</li></ul><p>{t("home.faq.get.a2")}</p></div></details>
              <details><summary>{t("home.faq.payment.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.payment.a")}</p></div></details>
              <details><summary>{t("home.faq.outbid.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.outbid.a")}</p></div></details>
              <details><summary>{t("home.faq.brands.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.brands.a")}</p></div></details>
              <details><summary>{t("home.faq.change.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p>{t("home.faq.change.a")}</p></div></details>
              <details><summary>{t("home.faq.list.q")}<span aria-hidden="true">+</span></summary><div className="faq-answer"><p><a href={CREATE_URL}>{t("home.faq.list.a")}</a></p></div></details>
            </div>
          </div>
        </section>

        <section className="waitlist-section" id="waitlist">
          <div className="waitlist-card">
            <p className="eyebrow">{t("home.yourMachineMinutes")}</p>
            <h2>{t("home.listOwnTitle")}</h2>
            <p>{t("home.listOwnBody")}</p>
            <a className="dark-button" href={CREATE_URL}>{t("home.createLaptop")}</a>
            <small>{t("home.selfHost")}</small>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-avatar" aria-hidden="true">T</div>
          <div>
            <p className="footer-title">{t("home.footerTitle")}</p>
            <p>{t("home.footerOpenSource")} <a href={SOURCE_URL} target="_blank" rel="noreferrer">Brand Anything ↗</a></p>
            <p>{t("home.footerContribute")} <a href={`${SOURCE_URL}/issues`} target="_blank" rel="noreferrer">GitHub ↗</a></p>
            <div className="footer-meta"><a href={CREATE_URL}>{t("common.listLaptop")}</a><a href={SOURCE_URL} target="_blank" rel="noreferrer">{t("home.sourceGithub")}</a></div>
            <p className="legal">{t("home.legal")}</p>
          </div>
        </div>
      </footer>

      <a className="floating-cta" href={CREATE_URL}>{t("common.listLaptopArrow")}</a>
      <BidDialog
        key={selectedSpot?.id ?? "closed"}
        spot={selectedSpot}
        onClose={() => setSelectedSpotId(null)}
        onSnapshot={applySnapshot}
      />
    </>
  );
}
