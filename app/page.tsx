"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type Currency = "EUR" | "USD";
type LidView = "live" | "final";
type TableView = "spots" | "history";

type Spot = {
  id: number;
  name: string;
  size: "S" | "M" | "L";
  dimensions: string;
  holder: string;
  bid: number;
  bids: number;
  logo?: string;
  website?: string;
};

const SPOTS: Spot[] = [
  { id: 2, name: "Marquee — above the logo", size: "L", dimensions: "9.5 × 5.5 cm", holder: "See.io", bid: 1715, bids: 3, logo: "/logos/see.png", website: "https://see.io" },
  { id: 1, name: "Top left banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "Postiz", bid: 1200, bids: 6, logo: "/logos/postiz.png", website: "https://postiz.io" },
  { id: 3, name: "Top right banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "PrivateAlps", bid: 1010, bids: 19, logo: "/logos/privatealps.png", website: "https://privatealps.net" },
  { id: 9, name: "Bottom center — under the logo", size: "M", dimensions: "9.5 × 4 cm", holder: "Felyn GO", bid: 710, bids: 16, logo: "/logos/felyn.jpg" },
  { id: 8, name: "Bottom left strip", size: "M", dimensions: "9.5 × 4 cm", holder: "VedicAstrology.com", bid: 666, bids: 13, logo: "/logos/vedic.png", website: "https://vedicastrology.com" },
  { id: 10, name: "Bottom right strip", size: "M", dimensions: "9.5 × 4 cm", holder: "Clipory", bid: 500, bids: 14, logo: "/logos/clipory.svg", website: "https://clipory.app" },
  { id: 5, name: "Inner left — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Surf Office", bid: 410, bids: 12, logo: "/logos/surfoffice.png", website: "https://www.surfoffice.com" },
  { id: 6, name: "Inner right — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "emma.pet", bid: 377, bids: 12, logo: "/logos/emma.png", website: "https://emma.pet" },
  { id: 4, name: "Middle left", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Draftline Fantasy", bid: 375, bids: 17, logo: "/logos/draftline.svg", website: "https://www.draftlinefantasy.com" },
  { id: 7, name: "Middle right", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Moyai", bid: 370, bids: 11, logo: "/logos/moyai.png", website: "https://moyai.ai" },
];

const HISTORY = [
  { brand: "See.io", spot: 2, amount: 1715, time: "18 minutes ago" },
  { brand: "PrivateAlps", spot: 3, amount: 1010, time: "34 minutes ago" },
  { brand: "Postiz", spot: 1, amount: 1200, time: "1 hour ago" },
  { brand: "Felyn GO", spot: 9, amount: 710, time: "2 hours ago" },
  { brand: "VedicAstrology.com", spot: 8, amount: 666, time: "3 hours ago" },
  { brand: "Clipory", spot: 10, amount: 500, time: "4 hours ago" },
  { brand: "Surf Office", spot: 5, amount: 410, time: "5 hours ago" },
  { brand: "emma.pet", spot: 6, amount: 377, time: "6 hours ago" },
];

const FAQS = [
  {
    question: "Is this real?",
    answer: (
      <p>Completely. The MacBook is real (well, imminent), the stickers are real vinyl, and I will travel with it and work with it in public spaces. The only fictional thing is the idea that a laptop lid isn&apos;t premium ad inventory.</p>
    ),
  },
  {
    question: "Why this MacBook?",
    answer: (
      <>
        <p>In short: I need a new laptop + I&apos;m building for iOS = MacBook.</p>
        <p>I&apos;ve been indie hacking for a year and a half now, pretty limited by my old dying laptop whenever I wanted to go somewhere.</p>
        <p>I&apos;ve also started building mobile apps, and building for iOS without a Mac is just the worst. I&apos;d like to finally be able to build in Swift too.</p>
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
      <p>Bidding takes a 20% deposit (minimum 10 €), paid by card when you place the bid. If you don&apos;t win, it comes back in full, automatically. If you do, it counts toward the price and I send a payment link for the remainder. Bids are settled in euros; the dollar prices shown are indicative.</p>
    ),
  },
  {
    question: "What if someone outbids me?",
    answer: <p>You get an honorable mention in the bid history and the chance to swing back. Outbids need to beat the current bid by at least 10 €.</p>,
  },
  {
    question: "Can any brand join?",
    answer: <p>Almost. Every sponsor is approved by hand before anything appears, and I keep the final say on what goes on the lid — it travels with me, after all. If your bid is refused, your deposit comes back in full.</p>,
  },
  {
    question: "Why not just buy the MacBook?",
    answer: <p>I&apos;ve been needing one for months. MRR is increasing but I&apos;m still far from being able to afford it at the moment. If this flops, I&apos;ll keep waiting until the day I can get one — but you won&apos;t be on it then.</p>,
  },
  {
    question: "Can I do this with my own laptop?",
    answer: (
      <p>That was the most asked question, so I built it: BrandMyLaptop.com. You set your machine and your prices — Mac or PC — and brands buy the spots at the price you named. <a href="https://brandmylaptop.com/?ref=brandmymac-faq">List your laptop →</a></p>
    ),
  },
];

function formatMoney(amount: number, currency: Currency) {
  const converted = currency === "EUR" ? amount : Math.round(amount * 1.17);
  return `${new Intl.NumberFormat("fr-FR").format(converted)} ${currency === "EUR" ? "€" : "$"}`;
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
  if (!spot.logo) return <span>{spot.holder}</span>;
  return (
    <span className={`brand-logo ${compact ? "brand-logo--compact" : ""}`}>
      <Image src={spot.logo} alt={spot.holder} width={180} height={100} sizes="180px" />
    </span>
  );
}

function MacLid({ currency, onSelect }: { currency: Currency; onSelect: (spot: Spot) => void }) {
  return (
    <div className="lid-stage" aria-label="MacBook sticker auction layout">
      <div className="mac-lid">
        <div className="lid-camera" />
        <span className="apple-mark" aria-label="Apple logo"></span>
        {SPOTS.map((spot) => (
          <button
            className={`lid-spot lid-spot--${spot.id}`}
            key={spot.id}
            onClick={() => onSelect(spot)}
            aria-label={`Spot ${spot.id}, ${spot.name}, ${spot.size}. Reserved by ${spot.holder} at ${formatMoney(spot.bid, currency)}. Outbid.`}
          >
            <Logo spot={spot} />
            <span className="lid-holder">{spot.holder}</span>
            <span className="lid-price">{formatMoney(spot.bid, currency)}</span>
            <span className="lid-outbid">Outbid</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CurrencySwitch({ currency, onChange }: { currency: Currency; onChange: (currency: Currency) => void }) {
  return (
    <div className="currency-switch" role="group" aria-label="Display currency">
      <button className={currency === "EUR" ? "active" : ""} aria-pressed={currency === "EUR"} onClick={() => onChange("EUR")}>€</button>
      <button className={currency === "USD" ? "active" : ""} aria-pressed={currency === "USD"} onClick={() => onChange("USD")}>$</button>
    </div>
  );
}

function BidDialog({ spot, currency, onClose }: { spot: Spot | null; currency: Currency; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [bid, setBid] = useState(() => spot ? String(spot.bid + 10) : "");
  const [logoName, setLogoName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (spot && !dialog.open) dialog.showModal();
    if (!spot && dialog.open) dialog.close();
  }, [spot]);

  const amount = Number(bid) || 0;
  const deposit = Math.ceil(amount * 0.2);

  return (
    <dialog ref={dialogRef} className="bid-dialog" onClose={onClose} onClick={(event) => {
      if (event.target === dialogRef.current) onClose();
    }}>
      {spot && (
        <div className="bid-panel">
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
          {!submitted ? (
            <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
              <div className="bid-heading">
                <p className="eyebrow">Spot {spot.id}</p>
                <h3>{spot.name}</h3>
                <p>{spot.size === "L" ? "Large" : spot.size === "M" ? "Medium" : "Small"} sticker · {spot.dimensions}</p>
                <p className="current-bid">Current bid <strong>{formatMoney(spot.bid, currency)}</strong> by {spot.holder} · {spot.bids} bids</p>
              </div>

              <label htmlFor="bid">Your bid ({currency})</label>
              <div className="money-input">
                <input id="bid" type="number" min={spot.bid + 10} step="10" value={bid} onChange={(event) => setBid(event.target.value)} required />
                <span>{currency === "EUR" ? "€" : "$"}</span>
              </div>
              <p className="field-note">Minimum {formatMoney(spot.bid + 10, currency)}</p>

              <div className="deposit-box">
                <p><span>Deposit, 20% of {formatMoney(amount, currency)}</span><span>{formatMoney(deposit, currency)}</span></p>
                <p className="due"><span>Due now</span><strong>{formatMoney(deposit, currency)}</strong></p>
                <small>Refunded in full if you don&apos;t win. If you do, the remaining {formatMoney(Math.max(0, amount - deposit), currency)} is due when the auction closes.</small>
              </div>

              <div className="form-grid">
                <label>Brand name<input type="text" placeholder="Microsoft" required /></label>
                <label>Email<input type="email" placeholder="you@microsoft.com" required /></label>
                <label>Website <span>(optional)</span><input type="url" placeholder="https://microsoft.com" /></label>
                <label>X handle <span>(optional)</span><input type="text" placeholder="@microsoft" /></label>
              </div>

              <label className="upload-label" htmlFor="logo-upload">Logo</label>
              <label className="upload-zone" htmlFor="logo-upload">
                <input id="logo-upload" type="file" accept=".png,.jpg,.jpeg,.svg" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} />
                <span className="upload-icon">⇧</span>
                <strong>{logoName || "Upload your logo"}</strong>
                <small>{logoName ? "Ready to preview" : "PNG · JPG · SVG"}</small>
              </label>

              <button className="primary-button bid-submit" type="submit">Outbid {spot.holder}</button>
              <p className="hand-check">I check every logo by hand before it goes on the lid.</p>
            </form>
          ) : (
            <div className="bid-success" role="status">
              <span>✓</span>
              <h3>Your bid preview is ready.</h3>
              <p>This replica keeps checkout in demo mode, so no card was charged. The complete bid flow and form state are working locally.</p>
              <button className="primary-button" onClick={onClose}>Back to the auction</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export default function Home() {
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [lidView, setLidView] = useState<LidView>("live");
  const [tableView, setTableView] = useState<TableView>("spots");
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const countdown = useCountdown();
  const totalRaised = useMemo(() => SPOTS.reduce((sum, spot) => sum + spot.bid, 0), []);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <nav className="site-nav">
        <div className="nav-inner">
          <a className="wordmark" href="#top" aria-label="Brand My Mac home">
            <Image src="/logo-small.png" alt="" width={41} height={27} priority />
            <span>Brand My Mac</span>
          </a>
          <div className="nav-links">
            <a href="#spots">Live auction</a>
            <a href="#how">How it works</a>
            <a href="#specs">The machine</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-actions">
            <CurrencySwitch currency={currency} onChange={setCurrency} />
            <a className="dark-button" href="#spots">Get a spot</a>
          </div>
        </div>
      </nav>

      <main id="main-content">
        <header className="hero" id="top">
          <div className="live-visitors"><span />181 people visiting this site now</div>
          <p className="total-visits"><span>·</span><strong>90,910</strong> total</p>
          <h1>Your brand, on my Mac.</h1>
          <p className="hero-subtitle">Your logo travels with me on a founder&apos;s best friend: the MacBook.</p>

          <div className="funding">
            <div className="funding-row">
              <p><strong>{formatMoney(totalRaised, currency)}</strong><span>raised</span></p>
              <p>goal passed · <strong>290%</strong></p>
            </div>
            <div className="progress-track"><span /></div>
            <p className="auction-time">Auction ends in {countdown} · you can still outbid any spot</p>
          </div>

          <div className={`lid-view ${lidView === "final" ? "lid-view--final" : ""}`}>
            {lidView === "live" ? (
              <MacLid currency={currency} onSelect={setSelectedSpot} />
            ) : (
              <div className="final-mac">
                <Image src="/macbook.webp" alt="A MacBook Pro seen from behind, its lid carrying the reserved stickers" width={1536} height={1024} priority sizes="(max-width: 768px) 96vw, 900px" />
                {SPOTS.map((spot) => (
                  <span className={`final-sticker final-sticker--${spot.id}`} key={spot.id} aria-hidden="true">
                    {spot.logo && <Image src={spot.logo} alt="" width={180} height={100} sizes="120px" />}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="segmented" role="group" aria-label="Lid view">
            <button className={lidView === "live" ? "active" : ""} aria-pressed={lidView === "live"} onClick={() => setLidView("live")}>Live auction</button>
            <button className={lidView === "final" ? "active" : ""} aria-pressed={lidView === "final"} onClick={() => setLidView("final")}>Final look</button>
          </div>
          <p className="lid-caption">{lidView === "live" ? "Tap any spot to place a bid." : "A glimpse at what the MacBook could look like."}</p>

          <div className="hero-close">
            <p>I&apos;m financing my first MacBook by selling the one surface everyone sees: the lid.</p>
            <p>Cafés, coworking spaces, events… get your brand in the outside world</p>
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
            <p className="auction-status"><span />ends in {countdown} <b>·</b> 10 of 10 sticker spots taken</p>
            <h2>The auction, live.</h2>
            <p className="section-lead">Every spot shows its current top bid.</p>
            <p className="section-copy">Spots from {formatMoney(125, currency)} Small · {formatMoney(200, currency)} Medium · {formatMoney(400, currency)} Large, with a premium next to and around the Apple logo.</p>

            <div className="segmented table-tabs" role="tablist" aria-label="Table view">
              <button role="tab" className={tableView === "spots" ? "active" : ""} aria-selected={tableView === "spots"} onClick={() => setTableView("spots")}>Spots</button>
              <button role="tab" className={tableView === "history" ? "active" : ""} aria-selected={tableView === "history"} onClick={() => setTableView("history")}>History (123)</button>
            </div>

            {tableView === "spots" ? (
              <div className="spots-table-wrap" role="region" aria-label="Sticker spot bids" tabIndex={0}>
                <table className="spots-table">
                  <thead><tr><th>Spot</th><th>Size</th><th>Held by</th><th>Current bid</th><th><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>
                    {SPOTS.map((spot) => (
                      <tr key={spot.id}>
                        <td data-label="Spot"><span className="spot-number">{spot.id}</span><strong>{spot.name}</strong></td>
                        <td data-label="Size"><span className={`size-tag size-tag--${spot.size.toLowerCase()}`}>{spot.size}</span>{spot.dimensions}</td>
                        <td data-label="Held by">{spot.website ? <a href={spot.website} target="_blank" rel="noreferrer"><Logo spot={spot} compact /></a> : <Logo spot={spot} compact />}</td>
                        <td data-label="Current bid"><strong>{formatMoney(spot.bid, currency)}</strong><small>{spot.bids} bids</small></td>
                        <td data-label="Action"><button className="outbid-button" onClick={() => setSelectedSpot(spot)}>Outbid</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="history-list" role="tabpanel">
                {HISTORY.map((item, index) => (
                  <div className="history-row" key={`${item.brand}-${index}`}>
                    <span className="history-avatar">{item.brand.charAt(0)}</span>
                    <p><strong>{item.brand}</strong> bid on spot {item.spot}<small>{item.time}</small></p>
                    <strong>{formatMoney(item.amount, currency)}</strong>
                  </div>
                ))}
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
            <p className="specs-intro">Here are the exact specs. About 21% of everything raised goes to French taxes before I buy anything lol, so the {formatMoney(2529, currency)} is really covered around {formatMoney(3200, currency)}. Anything above that supports my indie journey and the future trips the laptop and I will go on!</p>
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
            <p className="spec-note">Priced in euros at Apple France, which is where I&apos;m buying it. Dollar figures on this page are converted. Anything raised past the goal pays for the trips the Mac goes on. <a href="https://www.apple.com/fr/shop/buy-mac/macbook-pro" target="_blank" rel="noreferrer">Check the price at Apple.</a></p>
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
            <p className="eyebrow">The idea grew up</p>
            <h2>Want to do this with your own laptop?</h2>
            <p>You can, now: this auction grew into <strong>BrandMyLaptop.</strong> Set your machine and your prices — Mac or PC — and brands buy the spots at the price you named.</p>
            <a className="dark-button" href="https://brandmylaptop.com/?ref=brandmymac">List your laptop →</a>
            <small>This auction stays here — it is the listing that started it.</small>
          </div>
        </section>

        <section className="traffic-section" id="traffic" aria-labelledby="traffic-title">
          <div className="traffic-heading">
            <div><p className="eyebrow">A little proof of travel</p><h2 id="traffic-title">The launch, live around the world.</h2></div>
            <span><i /> Live traffic</span>
          </div>
          <div className="traffic-frame">
            <iframe src="https://datafa.st/share/6a8def30d1b34adfb3979864?realtime=1" title="Live traffic for brandmymac.com" loading="lazy" />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <Image src="/vincent.webp" alt="Vincent" width={72} height={72} />
          <div>
            <p className="footer-title">Hey, I&apos;m Vincent 👋</p>
            <p>Solo founder, indie hacking for a year and a half. I build in public, ship SaaS, mobile apps, and even do some game dev. I&apos;m funding my first MacBook by renting out its lid. Questions, or want a spot? <a href="https://x.com/vynsedev">Find me on X</a> or <a href="mailto:contact@vynse.dev">email me</a>.</p>
            <p>Want to do this with your own laptop? <a href="#waitlist">Join the waitlist.</a></p>
            <div className="footer-meta"><a href="#">Privacy</a><a href="#">Terms</a></div>
            <p className="legal">Brand My Mac is not affiliated with, endorsed by, or sponsored by Apple Inc. MacBook Pro and Mac are trademarks of Apple Inc.</p>
          </div>
        </div>
      </footer>

      <a className="floating-cta" href="https://brandmylaptop.com/?ref=brandmymac">Brand your laptop →</a>
      <BidDialog key={selectedSpot?.id ?? "closed"} spot={selectedSpot} currency={currency} onClose={() => setSelectedSpot(null)} />
    </>
  );
}
