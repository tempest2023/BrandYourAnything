"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function dollars(value: string, fallback: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

export function CreateLaptopForm() {
  const [title, setTitle] = useState("My travelling laptop");
  const [tagline, setTagline] = useState("Put your brand on the lid I carry everywhere.");
  const [laptopModel, setLaptopModel] = useState("MacBook Pro 14-inch");
  const [slug, setSlug] = useState("my-travelling-laptop");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [smallBid, setSmallBid] = useState("125");
  const [mediumBid, setMediumBid] = useState("200");
  const [largeBid, setLargeBid] = useState("400");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [auctionEnd, setAuctionEnd] = useState(defaultAuctionEnd);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdLocation, setCreatedLocation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const prices = useMemo(() => ({
    S: dollars(smallBid, 125),
    M: dollars(mediumBid, 200),
    L: dollars(largeBid, 400),
  }), [largeBid, mediumBid, smallBid]);

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
    formData.set("goalCents", String(Math.round(Number(formData.get("goalDollars")) * 100)));
    formData.set("smallOpeningBidCents", String(Math.round(prices.S * 100)));
    formData.set("mediumOpeningBidCents", String(Math.round(prices.M * 100)));
    formData.set("largeOpeningBidCents", String(Math.round(prices.L * 100)));
    formData.set("minIncrementCents", String(Math.round(Number(formData.get("minIncrementDollars")) * 100)));
    formData.set("auctionClosesAt", new Date(auctionEnd).toISOString());
    formData.set("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch("/api/laptops", { method: "POST", body: formData });
      const payload = await response.json() as CreateResponse;
      if (!response.ok || !payload.location) {
        setErrorMessage(payload.error || "We could not publish this laptop. Please try again.");
        if (payload.result?.reason === "idempotency_conflict") {
          setIdempotencyKey(crypto.randomUUID());
        }
        return;
      }
      setCreatedLocation(payload.location);
    } catch {
      setErrorMessage("The network did not confirm publication. Try again safely with the same details.");
    } finally {
      setSubmitting(false);
    }
  };

  if (createdLocation) {
    return (
      <main className={styles.successPage}>
        <div className={styles.successMark} aria-hidden="true">✓</div>
        <p className={styles.eyebrow}>Published</p>
        <h1>Your laptop has a front door.</h1>
        <p>The 10 sponsorship spots are live, the first bids can arrive now, and every visitor sees the same atomic auction state.</p>
        <div className={styles.successActions}>
          <Link className={styles.primaryAction} href={createdLocation}>Open your public laptop →</Link>
          <Link className={styles.secondaryAction} href="/">Back to Brand Anything</Link>
        </div>
        <code>{typeof window === "undefined" ? createdLocation : `${window.location.origin}${createdLocation}`}</code>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>Brand Anything</Link>
        <span>List your laptop</span>
        <Link href="/" className={styles.backLink}>View live example ↗</Link>
      </header>

      <div className={styles.shell}>
        <section className={styles.formSide} aria-labelledby="create-title">
          <div className={styles.formIntro}>
            <p className={styles.eyebrow}>Your machine. Your rules.</p>
            <h1 id="create-title">Turn the lid into limited inventory.</h1>
            <p>Publish a real 10-spot auction in one pass. No account setup and no borrowed sponsor data.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <fieldset>
              <legend><span>01</span> Campaign</legend>
              <label>
                Public title
                <input name="titlePreview" value={title} onChange={(event) => handleTitleChange(event.target.value)} minLength={3} maxLength={80} required />
              </label>
              <label>
                One-line promise
                <input name="taglinePreview" value={tagline} onChange={(event) => setTagline(event.target.value)} minLength={3} maxLength={160} required />
              </label>
              <label>
                Public URL
                <span className={styles.slugInput}><b>/laptop/</b><input value={slug} onChange={(event) => {
                  setSlugWasEdited(true);
                  setSlug(slugify(event.target.value));
                }} minLength={3} maxLength={48} required /></span>
              </label>
              <label>
                Why should brands join?
                <textarea name="story" rows={5} minLength={20} maxLength={1200} defaultValue="I work from cafés, events, and coworking spaces. Winning brands travel with me on the laptop lid and appear in the things I publish." required />
              </label>
            </fieldset>

            <fieldset>
              <legend><span>02</span> Laptop</legend>
              <label>
                Model
                <input name="laptopModelPreview" value={laptopModel} onChange={(event) => setLaptopModel(event.target.value)} minLength={2} maxLength={100} required />
              </label>
              <label className={styles.fileField}>
                Laptop photo <em>optional</em>
                <input name="photo" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => handlePhotoChange(event.target.files?.[0])} />
                <span>{photoPreview ? "Photo ready — choose another" : "Choose PNG, JPG, or WEBP · 5 MB max"}</span>
              </label>
            </fieldset>

            <fieldset>
              <legend><span>03</span> Auction</legend>
              <div className={styles.priceGrid}>
                <label>Small spots ($)<input type="number" min="10" max="100000" value={smallBid} onChange={(event) => setSmallBid(event.target.value)} required /></label>
                <label>Medium spots ($)<input type="number" min="10" max="100000" value={mediumBid} onChange={(event) => setMediumBid(event.target.value)} required /></label>
                <label>Large spots ($)<input type="number" min="10" max="100000" value={largeBid} onChange={(event) => setLargeBid(event.target.value)} required /></label>
              </div>
              <div className={styles.priceGrid}>
                <label>Campaign goal ($)<input name="goalDollars" type="number" min="100" max="1000000" defaultValue="3200" required /></label>
                <label>Minimum raise ($)<input name="minIncrementDollars" type="number" min="1" max="10000" defaultValue="10" required /></label>
                <label>Auction ends<input type="datetime-local" value={auctionEnd} onChange={(event) => setAuctionEnd(event.target.value)} required /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend><span>04</span> Owner</legend>
              <div className={styles.ownerGrid}>
                <label>Your public name<input name="ownerName" type="text" minLength={2} maxLength={80} placeholder="Tao" required /></label>
                <label>Private contact email<input name="ownerEmail" type="email" maxLength={254} placeholder="you@company.com" required /></label>
              </div>
              <p className={styles.privateNote}>Your email is stored privately for campaign ownership and is never returned by the public API.</p>
            </fieldset>

            {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
            <button className={styles.publishButton} type="submit" disabled={submitting || !auctionEnd}>
              {submitting ? "Publishing your laptop…" : "Publish my laptop →"}
            </button>
            <p className={styles.legal}>Publishing creates a public page. Bids are recorded, but no card is charged by this version.</p>
          </form>
        </section>

        <aside className={styles.previewSide} aria-label="Live laptop preview">
          <div className={styles.previewSticky}>
            <div className={styles.previewMeta}>
              <span>Live preview</span>
              <span>10 spots</span>
            </div>
            <div className={styles.previewCopy}>
              <p>brandanything.app/laptop/{slug || "your-url"}</p>
              <h2>{title || "Your laptop"}</h2>
              <p>{tagline || "Your one-line promise appears here."}</p>
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
                    <small>${prices[spot.size]}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.previewFooter}>
              <span>{laptopModel || "Laptop model"}</span>
              <span>USD auction</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
