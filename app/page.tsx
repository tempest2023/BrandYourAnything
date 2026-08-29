"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EUR_TO_USD,
  STARTER_HISTORY,
  STARTER_SPOTS,
  type AuctionSnapshot,
  type Currency,
  type PlaceBidResult,
  type Spot,
} from "@/lib/auction";

type LidView = "live" | "final";
type TableView = "spots" | "history";

const CAMPAIGN_GOAL_USD = 3200;
const SOURCE_URL = "https://github.com/tempest2023/BrandYourAnything";
const CREATE_URL = "/create";

const FAQS = [
  {
    question: "Is this real?",
    answer: (
      <p>Yes. This starter includes a working auction flow, persistent bids, and room for real sponsor logos. It intentionally ships with every spot open so your launch starts from a truthful blank slate.</p>
    ),
  },
  {
    question: "Why a MacBook lid?",
    answer: (
      <>
        <p>It is portable, recognisable, and visible wherever its owner works. The ten-zone layout turns that everyday surface into clear, limited inventory.</p>
        <p>Brand Anything is open source, so you can replace the MacBook, story, pricing, and campaign goal with an object that fits your own audience.</p>
      </>
    ),
  },
  {
    question: "What do I actually get?",
    answer: (
      <>
        <p>Your brand showing up both on socials and in the real world:</p>
        <ul>
          <li>A die-cut vinyl sticker of your logo on the lid — visible in public spaces and in my photos and vlogs.</li>
          <li>A spot on this page with a link to your site.</li>
        </ul>
        <p>I can&apos;t promise impressions or ROI, just that it goes where I work and appears in some of the stuff I post.</p>
      </>
    ),
  },
  {
    question: "How does payment work?",
    answer: (
      <p>The included backend records bids atomically in US dollars, but it does not charge a card. Connect your preferred payment provider before launch if you want deposits or automatic settlement.</p>
    ),
  },
  {
    question: "What if someone outbids me?",
    answer: <p>You stay in the public bid history and can bid again. After the opening bid, each new bid must beat the current leader by at least $10.</p>,
  },
  {
    question: "Can any brand join?",
    answer: <p>The starter assumes every sponsor and logo is reviewed before it appears. Define your own acceptance policy, then connect that approval step to whichever payment flow you choose.</p>,
  },
  {
    question: "Can I change the campaign?",
    answer: <p>Absolutely. The default copy, prices, auction date, object image, and ten spot positions are meant to be adapted. Keep only the parts that make sense for what you want to brand.</p>,
  },
  {
    question: "Can I list my own laptop?",
    answer: (
      <p>Yes. <a href={CREATE_URL}>Create your public laptop page</a>, set your story, goal, deadline, and three spot prices, then share the live auction URL. No fork or external website is required.</p>
    ),
  },
];

function displayAmount(amount: number, currency: Currency) {
  return currency === "USD" ? amount : Math.round(amount / EUR_TO_USD);
}

function formatMoney(amount: number, currency: Currency) {
  const converted = displayAmount(amount, currency);
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(converted);
}

function useCountdown() {
  const [countdown, setCountdown] = useState("11d 12h 49m");

  useEffect(() => {
    const auctionEnd = new Date("2026-09-09T08:00:00Z").getTime();
    const update = () => {
      const left = Math.max(0, auctionEnd - Date.now());
      const days = Math.floor(left / 86_400_000);
      const hours = Math.floor((left % 86_400_000) / 3_600_000);
      const minutes = Math.floor((left % 3_600_000) / 60_000);
      setCountdown(left > 0 ? `${days}d ${hours}h ${minutes}m` : "auction closing");
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return countdown;
}

function Logo({ spot, compact = false }: { spot: Spot; compact?: boolean }) {
  if (!spot.logo) return <span>{spot.holder || "Available"}</span>;
  return (
    <span className={`brand-logo ${compact ? "brand-logo--compact" : ""}`}>
      <Image src={spot.logo} alt={spot.holder} width={180} height={100} sizes="180px" />
    </span>
  );
}

function MacLid({ spots, currency, onSelect }: { spots: Spot[]; currency: Currency; onSelect: (spot: Spot) => void }) {
  return (
    <div className="lid-stage" aria-label="MacBook sticker auction layout">
      <div className="mac-lid">
        <div className="lid-camera" />
        <span className="apple-mark" aria-label="Apple logo"></span>
        {spots.map((spot) => {
          const hasBid = spot.bids > 0 && Boolean(spot.holder);

          return (
            <button
              className={`lid-spot lid-spot--${spot.id} ${hasBid ? "" : "lid-spot--available"}`}
              key={spot.id}
              onClick={() => onSelect(spot)}
              aria-label={hasBid
                ? `Spot ${spot.id}, ${spot.name}, ${spot.size}. Held by ${spot.holder} at ${formatMoney(spot.bid, currency)}. Outbid.`
                : `Spot ${spot.id}, ${spot.name}, ${spot.size}. Available from ${formatMoney(spot.minBid, currency)}. Place the first bid.`}
            >
              {hasBid ? <Logo spot={spot} /> : <span className="lid-spot-number">{spot.id}</span>}
              {(!hasBid || spot.logo) && <span className="lid-holder">{hasBid ? spot.holder : "Available"}</span>}
              <span className="lid-price">{hasBid ? formatMoney(spot.bid, currency) : `Starts ${formatMoney(spot.minBid, currency)}`}</span>
              <span className="lid-outbid">{hasBid ? "Outbid" : "Bid"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CurrencySwitch({ currency, onChange }: { currency: Currency; onChange: (currency: Currency) => void }) {
  return (
    <div className="currency-switch" role="group" aria-label="Display currency">
      <button className={currency === "USD" ? "active" : ""} aria-pressed={currency === "USD"} onClick={() => onChange("USD")}>$</button>
      <button className={currency === "EUR" ? "active" : ""} aria-pressed={currency === "EUR"} onClick={() => onChange("EUR")}>€</button>
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
  currency,
  onClose,
  onSnapshot,
}: {
  spot: Spot | null;
  currency: Currency;
  onClose: () => void;
  onSnapshot: (snapshot: AuctionSnapshot) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const minimumDisplayBid = spot ? Math.ceil(displayAmount(spot.minBid, currency)) : 0;
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
  const deposit = Math.ceil(amount * 0.2);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!spot || submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const amountCents = currency === "USD"
      ? Math.round(amount * 100)
      : Math.ceil(amount * 100 * EUR_TO_USD);
    formData.set("spotId", String(spot.id));
    formData.set("amountCents", String(amountCents));
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch("/api/bids", { method: "POST", body: formData });
      const payload = await response.json() as BidApiResponse;
      if (payload.snapshot) onSnapshot(payload.snapshot);

      if (!response.ok || !payload.result?.accepted) {
        setErrorMessage(payload.error || "The bid could not be saved. Please try again.");
        if (response.status === 409) setIdempotencyKey(crypto.randomUUID());
        return;
      }

      setAcceptedBid({
        brand: String(formData.get("brandName")),
        amountUsd: amountCents / 100,
      });
      setSubmitted(true);
    } catch {
      setErrorMessage("The network did not confirm your bid. Retrying will safely reuse the same request.");
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
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
          {!submitted ? (
            <form onSubmit={handleSubmit}>
              <div className="bid-heading">
                <p className="eyebrow">Spot {spot.id}</p>
                <h3>{spot.name}</h3>
                <p>{spot.size === "L" ? "Large" : spot.size === "M" ? "Medium" : "Small"} sticker · {spot.dimensions}</p>
                {spot.bids > 0 ? (
                  <p className="current-bid">Current bid <strong>{formatMoney(spot.bid, currency)}</strong> by {spot.holder} · {spot.bids} {spot.bids === 1 ? "bid" : "bids"}</p>
                ) : (
                  <p className="current-bid">Opening bid <strong>{formatMoney(spot.minBid, currency)}</strong> · no bids yet</p>
                )}
              </div>

              <label htmlFor="bid">Your bid ({currency})</label>
              <div className="money-input">
                <input id="bid" type="number" min={minimumDisplayBid} step="1" value={bid} onChange={(event) => setBidInput({ context: bidContext, value: event.target.value })} required />
                <span>{currency === "EUR" ? "€" : "$"}</span>
              </div>
              <p className="field-note">Minimum {formatMoney(spot.minBid, currency)} · bids are settled in US dollars</p>

              <div className="deposit-box">
                <p><span>Expected deposit, 20% of {formatMoney(amount, currency)}</span><span>{formatMoney(deposit, currency)}</span></p>
                <p className="due"><span>Payment integration</span><strong>Not charged yet</strong></p>
                <small>This backend records the bid atomically. Card authorization is a separate step and no payment is taken by this form yet.</small>
              </div>

              <div className="form-grid">
                <label>Brand name<input name="brandName" type="text" maxLength={80} placeholder="Microsoft" required /></label>
                <label>Email<input name="email" type="email" maxLength={254} placeholder="you@microsoft.com" required /></label>
                <label>Website <span>(optional)</span><input name="website" type="url" maxLength={2048} placeholder="https://microsoft.com" /></label>
                <label>X handle <span>(optional)</span><input name="xHandle" type="text" maxLength={50} placeholder="@microsoft" /></label>
              </div>

              <label className="upload-label" htmlFor="logo-upload">Logo</label>
              <label className="upload-zone" htmlFor="logo-upload">
                <input id="logo-upload" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} />
                <span className="upload-icon">⇧</span>
                <strong>{logoName || "Upload your logo"}</strong>
                <small>{logoName ? "Ready for private review" : "PNG · JPG · WEBP · SVG · 2 MB max"}</small>
              </label>

              {errorMessage && <p className="bid-error" role="alert">{errorMessage}</p>}
              <button className="primary-button bid-submit" type="submit" disabled={submitting}>
                {submitting ? "Saving bid…" : spot.bids > 0 ? `Outbid ${spot.holder}` : "Place the first bid"}
              </button>
              <p className="hand-check">I check every logo by hand before it goes on the lid.</p>
            </form>
          ) : (
            <div className="bid-success" role="status">
              <span>✓</span>
              <h3>Your bid is live.</h3>
              <p>{acceptedBid?.brand} is now leading with {formatMoney(acceptedBid?.amountUsd ?? spot.bid, currency)}. The database accepted it atomically and the public auction has been refreshed. No card was charged.</p>
              <button className="primary-button" onClick={onClose}>Back to the auction</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export default function Home() {
  const [currency, setCurrency] = useState<Currency>("USD");
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
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <nav className="site-nav">
        <div className="nav-inner">
          <a className="wordmark" href="#top" aria-label="Brand Anything home">
            <Image src="/logo-small.png" alt="" width={41} height={41} preload />
            <span>Brand Anything</span>
          </a>
          <div className="nav-links">
            <a href="#spots">Live auction</a>
            <a href="#how">How it works</a>
            <a href="#specs">The machine</a>
            <a href="#faq">FAQ</a>
            <a href={CREATE_URL}>List your laptop</a>
          </div>
          <div className="nav-actions">
            <CurrencySwitch currency={currency} onChange={setCurrency} />
            <a className="dark-button" href="#spots">Get a spot</a>
          </div>
        </div>
      </nav>

      <main id="main-content">
        <header className="hero" id="top">
          <div className="live-visitors"><span />Auction open for first bids</div>
          <p className="total-visits"><span>·</span><strong>{availableSpotCount}</strong> spots available</p>
          <h1>Your brand, on this Mac.</h1>
          <p className="hero-subtitle">Start with a blank lid. The winning logos turn it into something no one else carries.</p>

          <div className="funding">
            <div className="funding-row">
              <p><strong>{formatMoney(totalRaised, currency)}</strong><span>raised</span></p>
              <p>{formatMoney(CAMPAIGN_GOAL_USD, currency)} goal · <strong>{goalProgress}%</strong></p>
            </div>
            <div className="progress-track"><span style={{ width: `${goalProgress}%` }} /></div>
            <p className="auction-time">Auction ends in {countdown} · {filledSpotCount === 0 ? "be the first brand on the lid" : "you can still outbid any spot"}</p>
            <p className={`data-status data-status--${backendStatus}`} aria-live="polite">
              <span />{backendStatus === "live" ? "Live database connected" : backendStatus === "connecting" ? "Connecting live bids…" : "Showing the empty starter state — bids are temporarily unavailable"}
            </p>
          </div>

          <div className="lid-view">
            <div className={`lid-layer lid-layer--live ${lidView === "live" ? "is-active" : ""}`} aria-hidden={lidView !== "live"}>
              <MacLid spots={spots} currency={currency} onSelect={(spot) => setSelectedSpotId(spot.id)} />
            </div>
            <div className={`lid-layer lid-layer--final ${lidView === "final" && finalLookReady ? "is-active" : ""}`} aria-hidden={lidView !== "final" || !finalLookReady}>
              <div className="final-mac">
                <Image
                  src="/macbook.webp"
                  alt="A MacBook Pro seen from behind, ready for the winning brand stickers"
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
                <strong>{finalLookFailed ? "The final look could not load completely" : "Preparing the final look"}</strong>
                <small>{finalLookFailed ? "No partial composition was shown. Reload to try the missing asset again." : "Loading the MacBook and every brand together…"}</small>
                {finalLookFailed && <button type="button" onClick={() => window.location.reload()}>Reload assets</button>}
              </div>
            )}
          </div>

          <div className="segmented" role="group" aria-label="Lid view">
            <button className={lidView === "live" ? "active" : ""} aria-pressed={lidView === "live"} onClick={() => setLidView("live")}>Live auction</button>
            <button className={lidView === "final" ? "active" : ""} aria-pressed={lidView === "final"} onClick={() => setLidView("final")}>Final look</button>
          </div>
          <p className="lid-caption">{lidView === "live" ? "Tap any spot to place a bid." : finalLookFailed ? "The incomplete composition stays hidden." : !finalLookReady ? "The complete composition will appear when every asset is ready." : filledSpotCount === 0 ? "A clean slate — winning logos will appear here." : "Every winning brand, composed on the finished lid."}</p>

          <div className="hero-close">
            <p>Ten placements. Zero placeholder sponsors. The lid begins with the brands that actually bid.</p>
            <p>Cafés, coworking spaces, events… take your brand into the outside world.</p>
            <div>
              <a className="primary-button" href="#spots">Get a spot</a>
              <a className="text-link" href="#how">How it works ›</a>
            </div>
          </div>
        </header>

        <section className="statement" aria-labelledby="statement-title">
          <div className="statement-inner">
            <div>
              <p className="statement-kicker">The world&apos;s most recognisable lid</p>
              <h2 id="statement-title">Everyone recognises the apple. Show your logo right next to it.</h2>
              <a href="#spots">See the live auction ↘</a>
            </div>
            <div className="dark-mac" aria-hidden="true">
              <span className="dark-apple"></span>
              <i className="sticker-dot one" /><i className="sticker-dot two" /><i className="sticker-dot three" />
            </div>
          </div>
        </section>

        <section className="auction-section" id="spots">
          <div className="section-inner auction-inner">
            <p className="auction-status"><span />ends in {countdown} <b>·</b> {availableSpotCount} of {spots.length} sticker spots available</p>
            <h2>The auction, live.</h2>
            <p className="section-lead">Every open spot shows its starting bid. No demo brands, no borrowed history.</p>
            <p className="section-copy">Spots from {formatMoney(125, currency)} Small · {formatMoney(200, currency)} Medium · {formatMoney(400, currency)} Large, with a premium next to and around the Apple logo.</p>

            <div className="segmented table-tabs" role="tablist" aria-label="Table view">
              <button role="tab" className={tableView === "spots" ? "active" : ""} aria-selected={tableView === "spots"} onClick={() => setTableView("spots")}>Spots</button>
              <button role="tab" className={tableView === "history" ? "active" : ""} aria-selected={tableView === "history"} onClick={() => setTableView("history")}>History ({history.length})</button>
            </div>

            {tableView === "spots" ? (
              <div className="spots-table-wrap" role="region" aria-label="Sticker spot bids" tabIndex={0}>
                <table className="spots-table">
                  <thead><tr><th>Spot</th><th>Size</th><th>Brand</th><th>Bid</th><th><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>
                    {spots.map((spot) => (
                      <tr key={spot.id}>
                        <td data-label="Spot"><span className="spot-number">{spot.id}</span><strong>{spot.name}</strong></td>
                        <td data-label="Size"><span className={`size-tag size-tag--${spot.size.toLowerCase()}`}>{spot.size}</span>{spot.dimensions}</td>
                        <td data-label="Brand">{spot.bids === 0 ? <span className="availability-pill">Available</span> : spot.website ? <a href={spot.website} target="_blank" rel="noreferrer"><Logo spot={spot} compact /></a> : <Logo spot={spot} compact />}</td>
                        <td data-label={spot.bids === 0 ? "Starting bid" : "Current bid"}><strong>{formatMoney(spot.bids === 0 ? spot.minBid : spot.bid, currency)}</strong><small>{spot.bids === 0 ? "No bids yet" : `${spot.bids} ${spot.bids === 1 ? "bid" : "bids"}`}</small></td>
                        <td data-label="Action"><button className="outbid-button" onClick={() => setSelectedSpotId(spot.id)}>{spot.bids === 0 ? "Bid" : "Outbid"}</button></td>
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
                      <p><strong>{item.brand}</strong> bid on spot {item.spot}<small>{item.time}</small></p>
                      <strong>{formatMoney(item.amount, currency)}</strong>
                    </div>
                  )) : (
                    <div className="history-empty">
                      <span aria-hidden="true">01</span>
                      <strong>The first bid writes the first line.</strong>
                      <p>No imported winners or placeholder activity — this history starts with your launch.</p>
                    </div>
                  )}
              </div>
            )}
          </div>
        </section>

        <section className="how-section" id="how">
          <div className="section-inner how-inner">
            <h2>How it works</h2>
            <ol className="steps">
              <li><span>1</span><div><h3>Pick your spot and size</h3><p>Ten zones in three sticker sizes, priced by size and visibility.</p></div></li>
              <li><span>2</span><div><h3>Win the bid</h3><p>The top bid at the end of the auction wins. I&apos;ll reach out to arrange payment.</p></div></li>
              <li><span>3</span><div><h3>Your sticker rides along</h3><p>I print your logo as a quality die-cut vinyl sticker, and everywhere the MacBook goes, your brand is visible.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="specs-section" id="specs">
          <div className="section-inner specs-inner">
            <h2>What the money buys.</h2>
            <p className="specs-intro">This starter campaign uses a {formatMoney(CAMPAIGN_GOAL_USD, currency)} goal for the machine, taxes, production, and the trips that make the placements visible. Forking the template? Replace these figures with your real costs before launch.</p>
            <div className="spec-card">
              <div className="spec-card-head"><h3>MacBook Pro 14”, Silver</h3><strong>{formatMoney(2529, currency)}</strong></div>
              <dl>
                <div><dt>Chip</dt><dd>Apple M5 — 10-core CPU, 10-core GPU, 16-core Neural Engine</dd></div>
                <div><dt>Memory</dt><dd>32 GB unified</dd></div>
                <div><dt>Storage</dt><dd>1 TB SSD</dd></div>
                <div><dt>Display</dt><dd>14.2” Liquid Retina XDR, standard glass</dd></div>
                <div><dt>Keyboard</dt><dd>Backlit Magic Keyboard with Touch ID</dd></div>
                <div><dt>In the box</dt><dd>No power adapter</dd></div>
              </dl>
            </div>
            <p className="spec-note">Prices and bids are stored in US dollars. Euro figures are an indicative display conversion. Anything raised past the goal can fund production and the places the Mac goes. <a href="https://www.apple.com/shop/buy-mac/macbook-pro" target="_blank" rel="noreferrer">Check the current price at Apple.</a></p>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="section-inner faq-inner">
            <h2>Questions &amp; Answers</h2>
            <div className="faq-list">
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <div className="faq-answer">{faq.answer}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="waitlist-section" id="waitlist">
          <div className="waitlist-card">
            <p className="eyebrow">Your machine, live in minutes</p>
            <h2>List your own laptop.</h2>
            <p>Choose the public URL, tell your story, set the goal and prices, and publish a real 10-spot auction backed by the same concurrency-safe database.</p>
            <a className="dark-button" href={CREATE_URL}>Create your laptop →</a>
            <small>No external site and no code required. Prefer to self-host? The source remains open on GitHub.</small>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-avatar" aria-hidden="true">T</div>
          <div>
            <p className="footer-title">Hey, I&apos;m Tempest 👋</p>
            <p>I open-sourced this project so the idea would not belong to one finished MacBook. <a href={SOURCE_URL} target="_blank" rel="noreferrer">Brand Anything</a> is a starting point anyone can fork, reshape, and launch around their own story.</p>
            <p>Found a bug, built your own version, or want to improve the template? <a href={`${SOURCE_URL}/issues`} target="_blank" rel="noreferrer">Open an issue on GitHub.</a></p>
            <div className="footer-meta"><a href={CREATE_URL}>List your laptop</a><a href={SOURCE_URL} target="_blank" rel="noreferrer">Source on GitHub</a></div>
            <p className="legal">Brand Anything is not affiliated with, endorsed by, or sponsored by Apple Inc. MacBook Pro and Mac are trademarks of Apple Inc.</p>
          </div>
        </div>
      </footer>

      <a className="floating-cta" href={CREATE_URL}>List your laptop →</a>
      <BidDialog
        key={selectedSpot?.id ?? "closed"}
        spot={selectedSpot}
        currency={currency}
        onClose={() => setSelectedSpotId(null)}
        onSnapshot={applySnapshot}
      />
    </>
  );
}
