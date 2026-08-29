/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Spot } from "@/lib/auction";
import type { LaptopBidResult, LaptopSnapshot } from "@/lib/laptop";

import styles from "./laptop.module.css";

type BidResponse = {
  error?: string;
  result?: LaptopBidResult;
  snapshot?: LaptopSnapshot | null;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function useCountdown(closesAt: string) {
  const calculate = useCallback(() => {
    const left = Math.max(0, new Date(closesAt).getTime() - Date.now());
    if (left === 0) return "Auction closed";
    const days = Math.floor(left / 86_400_000);
    const hours = Math.floor((left % 86_400_000) / 3_600_000);
    const minutes = Math.floor((left % 3_600_000) / 60_000);
    return `${days}d ${hours}h ${minutes}m left`;
  }, [closesAt]);
  const [countdown, setCountdown] = useState(calculate);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(calculate()), 30_000);
    return () => window.clearInterval(timer);
  }, [calculate]);
  return countdown;
}

function LaptopLid({ spots, onSelect }: { spots: Spot[]; onSelect: (spot: Spot) => void }) {
  return (
    <div className="lid-stage" aria-label="Laptop sponsorship layout">
      <div className="mac-lid">
        <div className="lid-camera" />
        <span className="apple-mark" aria-label="Apple logo"></span>
        {spots.map((spot) => {
          const hasBid = spot.bids > 0;
          return (
            <button
              className={`lid-spot lid-spot--${spot.id} ${hasBid ? "" : "lid-spot--available"}`}
              key={spot.id}
              onClick={() => onSelect(spot)}
              aria-label={hasBid
                ? `Spot ${spot.id}, held by ${spot.holder} at ${formatMoney(spot.bid)}. Outbid.`
                : `Spot ${spot.id}, available from ${formatMoney(spot.minBid)}. Place bid.`}
            >
              {spot.logo ? (
                <span className="brand-logo"><img src={spot.logo} alt={spot.holder} /></span>
              ) : (
                <span className="lid-spot-number">{spot.id}</span>
              )}
              <span className="lid-holder">{hasBid ? spot.holder : "Available"}</span>
              <span className="lid-price">{hasBid ? formatMoney(spot.bid) : `Starts ${formatMoney(spot.minBid)}`}</span>
              <span className="lid-outbid">{hasBid ? "Outbid" : "Bid"}</span>
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
  onSnapshot,
}: {
  slug: string;
  spot: Spot;
  onSnapshot: (snapshot: LaptopSnapshot) => void;
}) {
  const [amount, setAmount] = useState(String(Math.ceil(spot.minBid)));
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
    formData.set("amountCents", String(Math.round(Number(amount) * 100)));
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch(`/api/laptops/${encodeURIComponent(slug)}/bids`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as BidResponse;
      if (payload.snapshot) onSnapshot(payload.snapshot);
      if (!response.ok || !payload.result?.accepted) {
        setErrorMessage(payload.error || "The bid could not be saved. Please try again.");
        if (response.status === 409) {
          setIdempotencyKey(crypto.randomUUID());
          if (payload.result?.minimumNextBid) setAmount(String(Math.ceil(payload.result.minimumNextBid)));
        }
        return;
      }
      setSuccessMessage(payload.result.reason === "already_processed"
        ? `Your ${formatMoney(Number(amount))} bid for spot ${spot.id} was already recorded. The page now shows the live winner.`
        : `You are leading spot ${spot.id} at ${formatMoney(payload.result.currentBid)}. No card was charged.`);
    } catch {
      setErrorMessage("The network did not confirm your bid. Retrying will safely reuse this request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <div className={styles.bidSuccess} role="status">
        <span aria-hidden="true">✓</span>
        <h3>Your bid is live.</h3>
        <p>{successMessage}</p>
      </div>
    );
  }

  return (
    <form className={styles.bidForm} onSubmit={handleSubmit}>
      <div className={styles.bidHeading}>
        <p>Spot {spot.id} · {spot.size}</p>
        <h3>{spot.name}</h3>
        <span>{spot.bids > 0 ? `${spot.holder} leads at ${formatMoney(spot.bid)}` : `Opening bid ${formatMoney(spot.minBid)}`}</span>
      </div>
      <label>Your bid (USD)<input type="number" min={Math.ceil(spot.minBid)} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <div className={styles.fieldPair}>
        <label>Brand name<input name="brandName" type="text" maxLength={80} placeholder="Your brand" required /></label>
        <label>Email<input name="email" type="email" maxLength={254} placeholder="you@company.com" required /></label>
      </div>
      <div className={styles.fieldPair}>
        <label>Website <em>optional</em><input name="website" type="url" maxLength={2048} placeholder="https://yourbrand.com" /></label>
        <label>X handle <em>optional</em><input name="xHandle" type="text" maxLength={50} placeholder="@yourbrand" /></label>
      </div>
      <label className={styles.logoUpload}>
        Logo <em>optional</em>
        <input name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} />
        <span>{logoName || "Choose PNG, JPG, WEBP, or SVG · 2 MB max"}</span>
      </label>
      {errorMessage && <p className={styles.bidError} role="alert">{errorMessage}</p>}
      <button type="submit" disabled={submitting}>{submitting ? "Saving bid…" : spot.bids > 0 ? `Outbid ${spot.holder} →` : "Place the first bid →"}</button>
      <small>Bids are final records in the public history. Payment is arranged separately by the laptop owner.</small>
    </form>
  );
}

export function LaptopAuction({ initialSnapshot }: { initialSnapshot: LaptopSnapshot }) {
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

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/laptops/${encodeURIComponent(snapshot.campaign.slug)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setSnapshot(await response.json() as LaptopSnapshot);
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
        <span className={backendStatus === "live" ? styles.live : styles.offline}>{backendStatus === "live" ? "Live auction" : "Reconnecting"}</span>
        <Link href="/create" className={styles.createLink}>List your laptop →</Link>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.ownerLine}>A laptop by {snapshot.campaign.ownerName}</p>
          <h1>{snapshot.campaign.title}</h1>
          <p>{snapshot.campaign.tagline}</p>
          <div className={styles.heroStats}>
            <span><b>{formatMoney(totalRaised)}</b> raised</span>
            <span><b>{filled}/10</b> spots claimed</span>
            <span><b>{countdown}</b></span>
          </div>
        </div>
        <div className={styles.lidWrap}>
          <LaptopLid spots={snapshot.spots} onSelect={(spot) => setSelectedSpotId(spot.id)} />
          <p>Tap any spot to bid · {snapshot.campaign.laptopModel}</p>
        </div>
      </header>

      <section className={styles.progressSection} aria-label="Campaign progress">
        <div><span style={{ width: `${progress}%` }} /></div>
        <p><b>{progress}%</b> of the {formatMoney(snapshot.campaign.goal)} campaign goal</p>
      </section>

      <section className={styles.auctionSection} id="auction">
        <div className={styles.auctionIntro}>
          <p>Ten placements. One lid.</p>
          <h2>Choose where your brand travels.</h2>
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
                <p><b>{spot.name}</b><small>{spot.size} · {spot.dimensions}</small></p>
                <strong>{formatMoney(spot.bids > 0 ? spot.bid : spot.minBid)}<small>{spot.bids > 0 ? `${spot.bids} bids` : "opening"}</small></strong>
              </button>
            ))}
          </div>
          <div className={styles.bidColumn}>
            {selectedSpot && (
              <BidPanel
                key={selectedSpot.id}
                slug={snapshot.campaign.slug}
                spot={selectedSpot}
                onSnapshot={setSnapshot}
              />
            )}
          </div>
        </div>
      </section>

      <section className={styles.storySection}>
        <div>
          <p>Why this laptop?</p>
          <h2>{snapshot.campaign.story}</h2>
          <dl>
            <div><dt>Machine</dt><dd>{snapshot.campaign.laptopModel}</dd></div>
            <div><dt>Owner</dt><dd>{snapshot.campaign.ownerName}</dd></div>
            <div><dt>Auction closes</dt><dd>{new Date(snapshot.campaign.closesAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}</dd></div>
          </dl>
        </div>
        <div className={styles.ownerPhoto}>
          {snapshot.campaign.photoUrl ? (
            <img src={snapshot.campaign.photoUrl} alt={`${snapshot.campaign.ownerName}'s ${snapshot.campaign.laptopModel}`} />
          ) : (
            <div><span></span><p>{snapshot.campaign.laptopModel}</p></div>
          )}
        </div>
      </section>

      <section className={styles.historySection}>
        <div className={styles.historyHead}><h2>Bid history</h2><span>{snapshot.history.length} recent</span></div>
        {snapshot.history.length > 0 ? snapshot.history.map((bid) => (
          <div className={styles.historyRow} key={bid.id}>
            <span>{bid.brand.charAt(0).toUpperCase()}</span>
            <p><b>{bid.brand}</b><small>Spot {bid.spot} · {bid.time}</small></p>
            <strong>{formatMoney(bid.amount)}</strong>
          </div>
        )) : (
          <div className={styles.emptyHistory}>
            <b>The first bid starts the story.</b>
            <p>No placeholder sponsors and no imported history.</p>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <p>Want a page like this for your own machine?</p>
        <Link href="/create">List your laptop →</Link>
      </footer>
    </main>
  );
}
