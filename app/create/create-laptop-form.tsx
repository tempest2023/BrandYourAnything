"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import type { UploadedBrandModel } from "@/lib/brand-model";
import { LOCALES, type Locale } from "@/lib/i18n";
import { laptopPath, laptopUrl, SITE_HOST, SITE_URL } from "@/lib/site";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import { BrandAnythingSource, type AnythingSource } from "./brand-anything-source";
import styles from "./create.module.css";

const STEPS = ["Object", "Ownership", "Showcase", "Layout", "Prices", "Listing", "Placement", "Publish"] as const;
const DRAFT_STORAGE_KEY = "brand-anything-sell-draft";
const LEGACY_DRAFT_STORAGE_KEY = "brandmylaptop-sell-draft";
const PUBLISH_AFTER_AUTH_KEY = "brand-anything-publish-after-auth";
const MANAGER_KEY_STORAGE_KEY = "brand-anything-lid-manager-key";
const MANAGED_LID_STORAGE_KEY = "brand-anything-managed-lid";
const X_COMPOSE_URL = "https://x.com/compose/post";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_LANGUAGE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
};
const X_SHARE_POSTS: Record<Locale, (publicUrl: string, assetName: string, anything: boolean) => string> = {
  en: (publicUrl, assetName, anything) => anything
    ? `I’m opening a handful of brand placements on ${assetName}. Explore the 3D model and bid for a spot: ${publicUrl}\n#BrandAnything`
    : `I’m opening up the lid of my laptop to a handful of brands. Your logo travels with me through cafés, meetings and events — not just another banner ad. See the live auction: ${publicUrl}\n#BrandAnything`,
  zh: (publicUrl, assetName, anything) => anything
    ? `我正在为「${assetName}」开放少量品牌位置。查看 3D 模型并竞拍一个位置：${publicUrl}\n#BrandAnything`
    : `我准备把电脑盖上的有限品牌位置开放出来。你的 Logo 会跟着我出现在咖啡馆、会议和活动现场，而不只是又一个横幅广告。查看正在进行的竞拍：${publicUrl}\n#BrandAnything`,
  es: (publicUrl, assetName, anything) => anything
    ? `Voy a abrir unos pocos espacios de marca en ${assetName}. Explora el modelo 3D y puja por un lugar: ${publicUrl}\n#BrandAnything`
    : `Voy a abrir unos pocos espacios de la tapa de mi portátil a marcas. Tu logo viajará conmigo por cafés, reuniones y eventos, no será otro banner más. Mira la subasta en directo: ${publicUrl}\n#BrandAnything`,
};
const SHOWCASE_OPTIONS = [
  "Build in public — posts and videos",
  "Coworking spaces and cafés",
  "Conferences and meetups",
  "Business travel",
  "Client and investor meetings",
  "A campus or university",
  "Roads, marinas, hangars and public spaces",
] as const;

const TEN_SPOTS = [
  { id: 1, name: "Top left banner", size: "Large", price: "large" },
  { id: 2, name: "Marquee — above the logo", size: "Large", price: "large", premium: 1.25 },
  { id: 3, name: "Top right banner", size: "Large", price: "large" },
  { id: 4, name: "Middle left", size: "Small", price: "small" },
  { id: 5, name: "Inner left — beside the logo", size: "Small", price: "small", premium: 1.2 },
  { id: 6, name: "Inner right — beside the logo", size: "Small", price: "small", premium: 1.2 },
  { id: 7, name: "Middle right", size: "Small", price: "small" },
  { id: 8, name: "Bottom left strip", size: "Medium", price: "medium" },
  { id: 9, name: "Bottom centre — under the logo", size: "Medium", price: "medium", premium: 1.25 },
  { id: 10, name: "Bottom right strip", size: "Medium", price: "medium" },
] as const;

const SIX_SPOTS = [
  { id: 1, name: "Top left banner", size: "Large", price: "large" },
  { id: 2, name: "Top right banner", size: "Large", price: "large" },
  { id: 3, name: "Middle left — beside the logo", size: "Small", price: "small", premium: 1.2 },
  { id: 4, name: "Middle right — beside the logo", size: "Small", price: "small", premium: 1.2 },
  { id: 5, name: "Bottom left strip", size: "Medium", price: "medium" },
  { id: 6, name: "Bottom right strip", size: "Medium", price: "medium" },
] as const;

type PriceKey = "small" | "medium" | "large";
type Machine = "mac" | "pc" | "anything";
type Ownership = "own" | "fund";
type LayoutCount = 6 | 10;
type SellDraft = {
  step: number;
  furthestStep: number;
  machine: Machine;
  assetName: string;
  anythingSource: AnythingSource;
  brandModel: UploadedBrandModel | null;
  screenSize: 13 | 14 | 16;
  ownership: Ownership;
  machineCost: string;
  showcase: string[];
  extraNote: string;
  layoutCount: LayoutCount;
  smallPrice: string;
  mediumPrice: string;
  largePrice: string;
  specialSpot: boolean;
  specialPrice: string;
  listingDays: 7 | 14 | 21 | 30;
  stickerMonths: 6 | 12 | 24;
  title: string;
  slug: string;
};

type ManagedLid = {
  slug: string;
  title: string;
};

type CreateResponse = {
  error?: string;
  location?: string;
  result?: { reason: string; slug: string };
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function formatMoney(amount: number) {
  return `${moneyFormatter.format(Math.round(amount))} €`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function clampPrice(value: string, fallback: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 10 ? amount : fallback;
}

function isUnavailableXAuthError(message: string) {
  return /provider|not configured|not enabled|unsupported|disabled/i.test(message);
}

function getOrCreateManagerKey() {
  const saved = window.localStorage.getItem(MANAGER_KEY_STORAGE_KEY);
  if (saved && UUID_PATTERN.test(saved)) return saved;
  const key = crypto.randomUUID();
  window.localStorage.setItem(MANAGER_KEY_STORAGE_KEY, key);
  return key;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy was blocked by the browser.");
  }
}

function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="Brand Anything">
      <Image src="/logo-small.png" alt="" width={48} height={48} priority />
      <span>Brand Anything</span>
    </Link>
  );
}

function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Logo />
          <p>Turn the object you carry, drive, sail or fly into a finite marketplace for brands.</p>
          <a className={styles.builtBy} href="https://x.com/vynsedev" target="_blank" rel="noreferrer">
            <span>built by</span>
            <Image src="/vincent.webp" alt="" width={22} height={22} />
            <strong>Vincent</strong>
          </a>
        </div>
        <nav className={styles.footerNav} aria-label="Footer">
          <div>
            <h2>Marketplace</h2>
            <Link href="/">All auctions</Link>
            <Link href="/sell">Brand your anything</Link>
            <Link href="/">Your dashboard</Link>
          </div>
          <div>
            <h2>About</h2>
            <Link href="/#how">How it works</Link>
            <Link href="/#faq">Questions</Link>
            <Link href="/">Waitlist</Link>
          </div>
        </nav>
        <div className={styles.footerLegal}>
          <p>Brand placements are paid sponsorships, not endorsements. Creators remain responsible for placement rights, production and fulfilment.</p>
          <nav aria-label="Legal">
            <Link href="/">Terms</Link>
            <Link href="/">Privacy</Link>
            <a href="mailto:contact@vynse.dev">Contact</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function CreateLaptopForm() {
  const { locale } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [machine, setMachine] = useState<Machine>("mac");
  const [assetName, setAssetName] = useState("My car");
  const [anythingSource, setAnythingSource] = useState<AnythingSource>("model");
  const [brandModel, setBrandModel] = useState<UploadedBrandModel | null>(null);
  const [screenSize, setScreenSize] = useState<13 | 14 | 16>(14);
  const [ownership, setOwnership] = useState<Ownership>("own");
  const [machineCost, setMachineCost] = useState("");
  const [showcase, setShowcase] = useState<string[]>(SHOWCASE_OPTIONS.slice(0, 5));
  const [extraNote, setExtraNote] = useState("");
  const [layoutCount, setLayoutCount] = useState<LayoutCount>(10);
  const [smallPrice, setSmallPrice] = useState("125");
  const [mediumPrice, setMediumPrice] = useState("200");
  const [largePrice, setLargePrice] = useState("400");
  const [specialSpot, setSpecialSpot] = useState(true);
  const [specialPrice, setSpecialPrice] = useState("1500");
  const [listingDays, setListingDays] = useState<7 | 14 | 21 | 30>(30);
  const [stickerMonths, setStickerMonths] = useState<6 | 12 | 24>(12);
  const [title, setTitle] = useState("Your brand, on my Mac.");
  const [slug, setSlug] = useState("tempest");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRedirecting, setAuthRedirecting] = useState(false);
  const [xSignInUnavailable, setXSignInUnavailable] = useState(
    () => !isSupabaseBrowserConfigured(),
  );
  const [draftReady, setDraftReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdLocation, setCreatedLocation] = useState<string | null>(null);
  const [publishedLocation, setPublishedLocation] = useState<string | null>(null);
  const [managedLid, setManagedLid] = useState<ManagedLid | null>(null);
  const [shareLocale, setShareLocale] = useState<Locale>(locale);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied">("idle");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (copyFeedback !== "copied") return;
    const timer = window.setTimeout(() => setCopyFeedback("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    let draft: Partial<SellDraft> = {};
    const saved = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
      ?? window.sessionStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
    if (saved) {
      try {
        draft = JSON.parse(saved) as Partial<SellDraft>;
      } catch {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
        window.sessionStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      }
    }

    const timer = window.setTimeout(() => {
      if (saved) {
        if (Number.isInteger(draft.step) && draft.step! >= 0 && draft.step! < STEPS.length) setStep(draft.step!);
        if (Number.isInteger(draft.furthestStep) && draft.furthestStep! >= 0 && draft.furthestStep! < STEPS.length) setFurthestStep(draft.furthestStep!);
        if (draft.machine) setMachine(draft.machine);
        if (typeof draft.assetName === "string") setAssetName(draft.assetName);
        if (draft.anythingSource) setAnythingSource(draft.anythingSource);
        if (draft.brandModel
          && typeof draft.brandModel.storagePath === "string"
          && typeof draft.brandModel.uploadClaim === "string"
          && typeof draft.brandModel.fileName === "string"
          && typeof draft.brandModel.size === "number") {
          setBrandModel(draft.brandModel);
        }
        if (draft.screenSize) setScreenSize(draft.screenSize);
        if (draft.ownership) setOwnership(draft.ownership);
        if (typeof draft.machineCost === "string") setMachineCost(draft.machineCost);
        if (Array.isArray(draft.showcase)) setShowcase(draft.showcase);
        if (typeof draft.extraNote === "string") setExtraNote(draft.extraNote);
        if (draft.layoutCount) setLayoutCount(draft.layoutCount);
        if (typeof draft.smallPrice === "string") setSmallPrice(draft.smallPrice);
        if (typeof draft.mediumPrice === "string") setMediumPrice(draft.mediumPrice);
        if (typeof draft.largePrice === "string") setLargePrice(draft.largePrice);
        if (typeof draft.specialSpot === "boolean") setSpecialSpot(draft.specialSpot);
        if (typeof draft.specialPrice === "string") setSpecialPrice(draft.specialPrice);
        if (draft.listingDays) setListingDays(draft.listingDays);
        if (draft.stickerMonths) setStickerMonths(draft.stickerMonths);
        if (typeof draft.title === "string") setTitle(draft.title);
        if (typeof draft.slug === "string") setSlug(draft.slug);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(MANAGED_LID_STORAGE_KEY);
    if (!saved) return;
    const timer = window.setTimeout(() => {
      try {
        const candidate = JSON.parse(saved) as Partial<ManagedLid>;
        if (typeof candidate.slug === "string" && typeof candidate.title === "string") {
          setManagedLid({ slug: candidate.slug, title: candidate.title });
        }
      } catch {
        window.localStorage.removeItem(MANAGED_LID_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      step,
      furthestStep,
      machine,
      assetName,
      anythingSource,
      brandModel,
      screenSize,
      ownership,
      machineCost,
      showcase,
      extraNote,
      layoutCount,
      smallPrice,
      mediumPrice,
      largePrice,
      specialSpot,
      specialPrice,
      listingDays,
      stickerMonths,
      title,
      slug,
    }));
  }, [anythingSource, assetName, brandModel, draftReady, extraNote, furthestStep, largePrice, layoutCount, listingDays, machine, machineCost, mediumPrice, ownership, screenSize, showcase, slug, smallPrice, specialPrice, specialSpot, step, stickerMonths, title]);

  useEffect(() => {
    let active = true;
    const callbackParameters = new URLSearchParams([
      window.location.search.replace(/^\?/, ""),
      window.location.hash.replace(/^#/, ""),
    ].filter(Boolean).join("&"));
    const callbackError = callbackParameters.get("error_description")
      || callbackParameters.get("error_code")
      || (callbackParameters.get("error") ? "X did not complete sign in. Please try again." : "");

    if (!isSupabaseBrowserConfigured()) {
      const timer = window.setTimeout(() => {
        if (!active) return;
        setAuthReady(true);
        if (callbackError) setErrorMessage(callbackError);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }

    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAccessToken(session?.access_token ?? null);
      setAuthReady(true);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setAccessToken(data.session?.access_token ?? null);
      setAuthReady(true);
      if (callbackError || error) {
        window.sessionStorage.removeItem(PUBLISH_AFTER_AUTH_KEY);
        const message = callbackError || "Your X session could not be restored. Please try again.";
        if (isUnavailableXAuthError(message)) setXSignInUnavailable(true);
        setErrorMessage(message);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const prices = useMemo(() => ({
    small: clampPrice(smallPrice, layoutCount === 10 ? 125 : 250),
    medium: clampPrice(mediumPrice, layoutCount === 10 ? 200 : 400),
    large: clampPrice(largePrice, layoutCount === 10 ? 400 : 800),
  }), [largePrice, layoutCount, mediumPrice, smallPrice]);

  const baseSpots = layoutCount === 10 ? TEN_SPOTS : SIX_SPOTS;
  const previewSpots = baseSpots.map((spot) => ({
    ...spot,
    amount: Math.round(prices[spot.price as PriceKey] * ("premium" in spot ? spot.premium : 1)),
  }));
  const specialAmount = clampPrice(specialPrice, 1500);
  const totalFloor = previewSpots.reduce((sum, spot) => sum + spot.amount, 0) + (specialSpot ? specialAmount : 0);
  const minimumPrice = Math.min(...previewSpots.map((spot) => spot.amount));
  const fundingCost = Number(machineCost);
  const isAnything = machine === "anything";
  const objectName = isAnything ? assetName.trim() || "your object" : `${machine === "mac" ? "Mac" : "PC"} · ${screenSize}″`;
  const machineIsValid = ownership === "own" || (Number.isFinite(fundingCost) && fundingCost >= 100 && fundingCost <= 20_000);
  const objectIsValid = !isAnything || (assetName.trim().length >= 2 && brandModel !== null);
  const desiredPublicLocation = laptopPath(slug);
  const sharePost = X_SHARE_POSTS[shareLocale](laptopUrl(slug), objectName, isAnything);

  const selectLayout = (count: LayoutCount) => {
    setLayoutCount(count);
    if (count === 10) {
      setSmallPrice("125");
      setMediumPrice("200");
      setLargePrice("400");
    } else {
      setSmallPrice("250");
      setMediumPrice("400");
      setLargePrice("800");
    }
  };

  const goToStep = (index: number) => {
    if (index > furthestStep) return;
    setStep(index);
    setFurthestStep(index);
    setErrorMessage("");
  };

  const continueStep = () => {
    if (step === 0 && !objectIsValid) return;
    if (step === 1 && !machineIsValid) return;
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setFurthestStep(next);
    setErrorMessage("");
  };

  const backStep = () => {
    const previous = Math.max(step - 1, 0);
    setStep(previous);
    setFurthestStep(previous);
    setErrorMessage("");
  };

  const toggleShowcase = (option: string) => {
    setShowcase((current) => current.includes(option)
      ? current.filter((item) => item !== option)
      : [...current, option]);
  };

  const rememberManagedLid = (location: string) => {
    const entry = { slug, title };
    window.localStorage.setItem(MANAGED_LID_STORAGE_KEY, JSON.stringify(entry));
    setManagedLid(entry);
    setPublishedLocation(location);
  };

  const publishLaptop = async (form: HTMLFormElement, mode: "x" | "browser") => {
    if (publishedLocation === desiredPublicLocation) return publishedLocation;

    setSubmitting(true);
    setErrorMessage("");
    const formData = new FormData(form);
    const storyParts = [
      showcase.length ? `This ${isAnything ? "object" : "laptop"} is seen at: ${showcase.join(", ")}.` : `This ${isAnything ? "object" : "laptop"} travels with its owner every day.`,
      extraNote.trim(),
      `Each approved brand placement stays on for ${stickerMonths} months.`,
    ].filter(Boolean);

    formData.set("slug", slug);
    formData.set("title", title);
    formData.set("tagline", isAnything ? `Put your brand on ${objectName}.` : "Put your brand on the lid I carry everywhere.");
    formData.set("story", storyParts.join(" "));
    formData.set("laptopModel", objectName);
    formData.set("assetType", isAnything ? "anything" : "laptop");
    formData.set("assetName", objectName);
    if (brandModel && isAnything) {
      formData.set("modelStoragePath", brandModel.storagePath);
      formData.set("modelUploadClaim", brandModel.uploadClaim);
      formData.set("modelFileName", brandModel.fileName);
      formData.set("modelFileSize", String(brandModel.size));
    }
    formData.set("goalCents", String(Math.round((ownership === "fund" ? fundingCost : totalFloor) * 100)));
    formData.set("smallOpeningBidCents", String(Math.round(prices.small * 100)));
    formData.set("mediumOpeningBidCents", String(Math.round(prices.medium * 100)));
    formData.set("largeOpeningBidCents", String(Math.round(prices.large * 100)));
    formData.set("minIncrementCents", "1000");
    formData.set("auctionClosesAt", new Date(Date.now() + listingDays * 86_400_000).toISOString());
    formData.set("idempotencyKey", idempotencyKey);

    const headers: Record<string, string> = mode === "x" && accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : { "X-Lid-Manager-Key": getOrCreateManagerKey() };

    try {
      const response = await fetch("/api/laptops", { method: "POST", headers, body: formData });
      const payload = await response.json() as CreateResponse;
      if (!response.ok || !payload.location) {
        setErrorMessage(payload.error || "We could not publish this auction. Please try again.");
        if (payload.result?.reason === "idempotency_conflict") setIdempotencyKey(crypto.randomUUID());
        if (response.status === 401 && mode === "x" && isSupabaseBrowserConfigured()) {
          await getSupabaseBrowser().auth.signOut({ scope: "local" });
          setAccessToken(null);
        }
        return null;
      }
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      window.sessionStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      rememberManagedLid(payload.location);
      return payload.location;
    } catch {
      setErrorMessage("The network did not confirm publication. Try again safely with the same details.");
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const handleShareCopy = async (openX: boolean) => {
    const form = formRef.current;
    if (!form || submitting || !form.reportValidity()) return;
    setCopyFeedback("idle");
    const composeWindow = openX ? window.open("about:blank", "_blank") : null;
    if (composeWindow) composeWindow.opener = null;

    const location = await publishLaptop(form, "browser");
    if (!location) {
      composeWindow?.close();
      return;
    }
    const post = X_SHARE_POSTS[shareLocale](`${SITE_URL}${location}`, objectName, isAnything);

    if (openX) {
      const composeUrl = `${X_COMPOSE_URL}?text=${encodeURIComponent(post)}`;
      if (composeWindow) {
        composeWindow.location.replace(composeUrl);
      } else {
        window.open(composeUrl, "_self");
      }
      return;
    }

    try {
      await copyText(post);
      setCopyFeedback("copied");
    } catch {
      setErrorMessage("Your browser blocked copying. Select the post text and copy it manually.");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || authRedirecting) return;

    if (!authReady) {
      setErrorMessage("Checking your X session. Please try again in a moment.");
      return;
    }

    if (!isSupabaseBrowserConfigured()) {
      setXSignInUnavailable(true);
      setErrorMessage("");
      return;
    }

    if (!accessToken) {
      window.sessionStorage.setItem(PUBLISH_AFTER_AUTH_KEY, "1");
      setAuthRedirecting(true);
      setErrorMessage("");

      try {
        const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
          provider: "x",
          options: { redirectTo: `${window.location.origin}/sell` },
        });
        if (error) throw error;
      } catch {
        window.sessionStorage.removeItem(PUBLISH_AFTER_AUTH_KEY);
        setAuthRedirecting(false);
        setXSignInUnavailable(true);
        setErrorMessage("");
      }
      return;
    }

    window.sessionStorage.removeItem(PUBLISH_AFTER_AUTH_KEY);
    const location = await publishLaptop(event.currentTarget, "x");
    if (location) setCreatedLocation(location);
  };

  useEffect(() => {
    if (!draftReady || !authReady || !accessToken || submitting || step !== STEPS.length - 1) return;
    if (window.sessionStorage.getItem(PUBLISH_AFTER_AUTH_KEY) !== "1") return;

    const timer = window.setTimeout(() => formRef.current?.requestSubmit(), 0);
    return () => window.clearTimeout(timer);
  }, [accessToken, authReady, draftReady, step, submitting]);

  if (createdLocation) {
    return (
      <main className={`${styles.page} ${styles.successPage}`}>
        <div className={styles.successMark} aria-hidden="true">✓</div>
        <p className={styles.successEyebrow}>Published</p>
        <h1>Your {isAnything ? "object" : "lid"} is live.</h1>
        <p>Brands can now explore {objectName}, see every spot, and join the auction.</p>
        <div className={styles.successActions}>
          <Link className={styles.primaryButton} href={createdLocation}>Open your public auction</Link>
          <Link className={styles.secondaryButton} href="/">Back to Brand Anything</Link>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}><Logo /></header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <p className={styles.heroKicker}>From Mac lids to moving machines</p>
          <h1>Put anything up.</h1>
          <p>You bring the object and set the prices; Brand Anything turns it into a live sponsorship auction.</p>
          {xSignInUnavailable ? managedLid && (
            <p className={styles.signIn}>Your auction is saved in this browser. <Link href={laptopPath(managedLid.slug)}>Manage {managedLid.title}</Link>.</p>
          ) : (
            <p className={styles.signIn}>Already published an auction? <Link href="/">Sign in to manage it</Link>.</p>
          )}

          <ol className={styles.steps} aria-label="Listing steps">
            {STEPS.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  className={index === step ? styles.activeStep : ""}
                  aria-current={index === step ? "step" : undefined}
                  disabled={index > furthestStep}
                  onClick={() => goToStep(index)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <form ref={formRef} className={styles.wizardGrid} onSubmit={handleSubmit}>
          <section className={styles.formPanel} aria-live="polite">
            {step === 0 && (
              <fieldset>
                <legend>What are you selling space on?</legend>
                <div className={styles.objectCards}>
                  <button type="button" className={machine === "mac" ? styles.selectedCard : styles.optionCard} aria-pressed={machine === "mac"} onClick={() => setMachine("mac")}>
                    <strong>A Mac</strong><span>The drawn lid wears the Apple mark, because yours does.</span>
                  </button>
                  <button type="button" className={machine === "pc" ? styles.selectedCard : styles.optionCard} aria-pressed={machine === "pc"} onClick={() => setMachine("pc")}>
                    <strong>A PC</strong><span>A bare lid. No maker&apos;s mark — it is not ours to print.</span>
                  </button>
                  <button
                    type="button"
                    className={machine === "anything" ? styles.selectedAnythingCard : styles.anythingCard}
                    aria-pressed={machine === "anything"}
                    onClick={() => {
                      setMachine("anything");
                      setSpecialSpot(false);
                    }}
                  >
                    <span className={styles.anythingGlyph} aria-hidden="true">✣</span>
                    <strong>Anything else</strong><span>Turn a car, boat, aircraft — or almost any object — into BrandMyAnything.</span>
                  </button>
                </div>
                {isAnything ? (
                  <BrandAnythingSource
                    assetName={assetName}
                    onAssetNameChange={setAssetName}
                    source={anythingSource}
                    onSourceChange={setAnythingSource}
                    model={brandModel}
                    onModelChange={setBrandModel}
                    getUploadHeaders={() => ({ "X-Lid-Manager-Key": getOrCreateManagerKey() })}
                  />
                ) : (
                  <>
                    <label className={styles.fieldLabel}>How big is the screen?</label>
                    <div className={styles.choiceRow}>
                      {([13, 14, 16] as const).map((size) => <button type="button" key={size} className={screenSize === size ? styles.selectedChoice : styles.choice} aria-pressed={screenSize === size} onClick={() => setScreenSize(size)}>{size}″</button>)}
                    </div>
                    <p className={styles.supporting}>A large sticker prints at <strong>9.5 × 5.5 cm</strong> on this one. Pick the nearest if yours is in between.</p>
                  </>
                )}
                <div className={styles.stripeNote}>One thing before you build: buyers pay into your own <strong>Stripe</strong> account, so you need one — free, three clicks if you have it already, and <a href="https://stripe.com/global" target="_blank" rel="noreferrer">available in these countries</a>.<button type="button">Stripe isn&apos;t available in my country →</button></div>
              </fieldset>
            )}

            {step === 1 && (
              <fieldset>
                <legend>Do you already own it?</legend>
                <div className={styles.stackedCards}>
                  <button type="button" className={ownership === "own" ? styles.selectedCard : styles.optionCard} aria-pressed={ownership === "own"} onClick={() => setOwnership("own")}>
                    <strong>I own it</strong><span>The object exists. What it raises is yours, and the page shows no goal to reach.</span>
                  </button>
                  <button type="button" className={ownership === "fund" ? styles.selectedCard : styles.optionCard} aria-pressed={ownership === "fund"} onClick={() => setOwnership("fund")}>
                    <strong>I&apos;m funding it</strong><span>What the spots sell for pays for the machine, and the page carries a progress bar towards its price. If the goal is not reached, you still owe every sold sticker — topping the machine up yourself, or refunding the buyers you cannot deliver.</span>
                  </button>
                </div>
                {ownership === "fund" && <label className={styles.inputLabel}>What does the machine cost?<span className={styles.moneyField}><input type="number" min="100" max="20000" value={machineCost} onChange={(event) => setMachineCost(event.target.value)} /><b>€</b></span><small>The maker&apos;s own price for the exact machine, so the bar means something.</small></label>}
                {!machineIsValid && <p className={styles.validation} role="alert">Give what the machine costs, between 100 € and 20 000 €.</p>}
              </fieldset>
            )}

            {step === 2 && (
              <fieldset>
                <legend>Where will it be seen?</legend>
                <p className={styles.introCopy}>Pick everything true — it is shown to buyers on your listing.</p>
                <div className={styles.checkList}>
                  {SHOWCASE_OPTIONS.map((option) => <label key={option} className={showcase.includes(option) ? styles.checkedRow : styles.checkRow}><input type="checkbox" checked={showcase.includes(option)} onChange={() => toggleShowcase(option)} />{option}</label>)}
                </div>
                <label className={styles.textareaLabel}>Anything else buyers should know? <span>Optional</span><textarea maxLength={400} placeholder="Everything this raises goes to a cancer charity." value={extraNote} onChange={(event) => setExtraNote(event.target.value)} /><small>{extraNote.length}/400</small></label>
              </fieldset>
            )}

            {step === 3 && (
              <fieldset>
                <legend>How many spots?</legend>
                <div className={styles.stackedCards}>
                  <button type="button" className={layoutCount === 10 ? styles.selectedCard : styles.optionCard} aria-pressed={layoutCount === 10} onClick={() => selectLayout(10)}><strong>Ten spots</strong><span>{isAnything ? "Hero, profile and detail placements orbit the model. The most inventory, with the lowest entry price." : "Three banners, four small marks around the logo, three strips. The most inventory, the lowest entry price."}</span></button>
                  <button type="button" className={layoutCount === 6 ? styles.selectedCard : styles.optionCard} aria-pressed={layoutCount === 6} onClick={() => selectLayout(6)}><strong>Six spots</strong><span>Fewer, larger placements. Each sponsor gets more of the {isAnything ? "object" : "lid"}, and the whole thing sells in fewer deals.</span></button>
                </div>
              </fieldset>
            )}

            {step === 4 && (
              <fieldset>
                <legend>What does a spot start at?</legend>
                <p className={styles.introCopy}>One price each, paid in full by whoever takes the spot. The figures below are what we suggest — change any of them. The ones around the centre carry a premium on top.</p>
                <div className={styles.priceList}>
                  <PriceField label={`${layoutCount === 10 ? 3 : 2} × Large`} dimensions={isAnything ? "Hero placement" : "9.5 × 5.5 cm printed"} value={largePrice} onChange={setLargePrice} />
                  <PriceField label={`${layoutCount === 10 ? 3 : 2} × Medium`} dimensions={isAnything ? "Profile placement" : "9.5 × 4 cm printed"} value={mediumPrice} onChange={setMediumPrice} />
                  <PriceField label={`${layoutCount === 10 ? 4 : 2} × Small`} dimensions={isAnything ? "Detail placement" : "4.5 × 4.5 cm printed"} value={smallPrice} onChange={setSmallPrice} />
                </div>
                {!isAnything && (
                  <label className={specialSpot ? styles.checkedSpecial : styles.specialSpot}>
                    <input type="checkbox" checked={specialSpot} onChange={(event) => setSpecialSpot(event.target.checked)} />
                    <span><strong>Add a special spot over the logo</strong><small>6 × 6 cm, covering the Apple mark in the middle of the lid. Name your own price — it is the one placement size says nothing about.</small></span>
                    {specialSpot && <span className={styles.specialPrice}><small>Starts at</small><span><input type="number" min="10" max="100000" value={specialPrice} onChange={(event) => setSpecialPrice(event.target.value)} /><b>€</b></span></span>}
                  </label>
                )}
                <p className={styles.totalCopy}>Every spot sold at its floor: <strong>{formatMoney(totalFloor)}</strong>, before the platform&apos;s 10% and Stripe&apos;s fees.{ownership === "fund" && machineIsValid ? ` Your goal is ${formatMoney(fundingCost)} — the sized spots were set to reach it, and the centre one is on top.` : ""}</p>
              </fieldset>
            )}

            {step === 5 && (
              <fieldset>
                <legend>How long does it run?</legend>
                <p className={styles.introCopy}>Long enough to be shared twice, short enough that a date on the page means something. Spots sell one at a time, so this is when the {isAnything ? "object" : "lid"} stops taking buyers rather than a finish line anybody races to.</p>
                <div className={styles.fourChoices}>{([7, 14, 21, 30] as const).map((days) => <button type="button" key={days} className={listingDays === days ? styles.selectedDuration : styles.duration} aria-pressed={listingDays === days} onClick={() => setListingDays(days)}><strong>{days}</strong><span>days</span></button>)}</div>
              </fieldset>
            )}

            {step === 6 && (
              <fieldset>
                <legend>How long do the placements stay on?</legend>
                <p className={styles.introCopy}>This is what a buyer is actually buying, so it is yours to set rather than ours. Longer is worth more — and if you mean to sell the object next year, do not promise two years of it.</p>
                <div className={styles.threeChoices}>{([6, 12, 24] as const).map((months) => <button type="button" key={months} className={stickerMonths === months ? styles.selectedDuration : styles.duration} aria-pressed={stickerMonths === months} onClick={() => setStickerMonths(months)}><strong>{months}</strong><span>months</span></button>)}</div>
                <p className={styles.stickerNote}>It is shown on your listing and on the board, and it runs from the day of each purchase. Remove a placement early and the buyer is refunded for the time left.</p>
              </fieldset>
            )}

            {step === 7 && (
              <fieldset>
                <legend>Name it, and put it up.</legend>
                <label className={styles.inputLabel}>Title<input type="text" value={title} minLength={3} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Ten spots on my MacBook Pro" required /></label>
                <label className={styles.inputLabel}>Address<span className={styles.addressField}><b>{SITE_HOST}/</b><input value={slug} minLength={3} maxLength={48} onChange={(event) => setSlug(slugify(event.target.value))} placeholder="your-name" required /><i aria-label="Address is available">✓</i></span></label>
                <dl className={styles.summary}>
                  <div><dt>Object</dt><dd>{objectName}</dd></div>
                  <div><dt>Ownership</dt><dd>{ownership === "own" ? "You own it" : `Funding ${formatMoney(fundingCost || 0)}`}</dd></div>
                  <div><dt>Layout</dt><dd>{layoutCount + (specialSpot ? 1 : 0)} spots{specialSpot ? ", logo covered" : ""}</dd></div>
                  <div><dt>If it all sells</dt><dd>{formatMoney(totalFloor)}</dd></div>
                  <div><dt>Runs for</dt><dd>{listingDays} days</dd></div>
                  <div><dt>Stickers stay</dt><dd>{stickerMonths} months</dd></div>
                </dl>
                <p className={styles.publishCopy}>Buyers pay you directly — the money lands in your own Stripe account, minus the 10% platform fee and Stripe&apos;s processing fees. You produce each placement to the agreed spec and approve every logo before it appears.</p>
                {xSignInUnavailable ? (
                  <section className={styles.shareFallback} aria-labelledby="x-share-title">
                    <h2 id="x-share-title">Share your auction instead.</h2>
                    <div className={styles.shareLanguageRow}>
                      <span>Post language</span>
                      <div role="group" aria-label="Post language">
                        {LOCALES.map((language) => (
                          <button
                            type="button"
                            key={language}
                            className={language === shareLocale ? styles.activeShareLanguage : styles.shareLanguage}
                            aria-pressed={language === shareLocale}
                            onClick={() => {
                              setShareLocale(language);
                              setCopyFeedback("idle");
                            }}
                          >
                            {SHARE_LANGUAGE_LABELS[language]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.shareCopyBox}>
                      <button type="button" className={styles.copyPostButton} disabled={submitting} onClick={() => void handleShareCopy(false)}>
                        {submitting ? "Publishing…" : copyFeedback === "copied" ? "Copied" : "Copy"}
                      </button>
                      <blockquote className={styles.shareCopy} lang={shareLocale}>{sharePost}</blockquote>
                    </div>
                    {copyFeedback === "copied" && (
                      <p className={styles.copyToast} role="status" aria-live="polite">Copied to your clipboard</p>
                    )}
                    {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                    <button type="button" className={styles.xShareButton} disabled={submitting} onClick={() => void handleShareCopy(true)}>
                      {submitting ? "Publishing…" : "Post on X"}<span aria-hidden="true">↗</span>
                    </button>
                    <p className={styles.shareNote}>{publishedLocation
                      ? "Your auction is live and saved in this browser. Copy the post again whenever you need it."
                      : "Copy or open X to publish your auction and save it in this browser. X opens in a new tab so this page stays here."}</p>
                  </section>
                ) : (
                  <>
                    {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                    <button className={styles.publishButton} type="submit" disabled={!authReady || submitting || authRedirecting}>
                      {submitting ? "Publishing…" : authRedirecting ? "Opening X…" : accessToken ? "Publish your auction" : "Sign in with X and publish"}
                    </button>
                    <p className={styles.authNote}>X is what a buyer checks before putting their logo on a stranger&apos;s {isAnything ? "object" : "laptop"}. Everything above is kept while you sign in; you land back here.</p>
                  </>
                )}
              </fieldset>
            )}

            {step < 7 && <div className={styles.actions}>{step > 0 && <button type="button" className={styles.backButton} onClick={backStep}>Back</button>}<button type="button" className={styles.continueButton} disabled={(step === 0 && !objectIsValid) || (step === 1 && !machineIsValid)} onClick={continueStep}>{step === 0 && isAnything && !brandModel ? "Upload a GLB to continue" : "Continue"}</button></div>}
          </section>

          <aside className={styles.previewColumn} aria-label={`${objectName} auction preview`}>
            {isAnything ? (
              <div className={styles.anythingMiniStage}>
                <span className={styles.miniOrbit} aria-hidden="true" />
                <div className={styles.miniObject} aria-hidden="true"><i /><i /><i /></div>
                <strong>{objectName}</strong>
                <small>{brandModel ? `${brandModel.fileName} · ready` : "Your GLB appears here"}</small>
                {previewSpots.map((spot, index) => (
                  <span key={spot.id} className={styles.miniMarker} style={{ "--marker-index": index } as React.CSSProperties}>{spot.id}</span>
                ))}
              </div>
            ) : (
              <div className={`${styles.lid} ${layoutCount === 6 ? styles.sixLid : styles.tenLid}`}>
                {machine === "mac" && <span className={styles.apple} aria-hidden="true"></span>}
                {previewSpots.map((spot) => (
                  <button
                    type="button"
                    key={spot.id}
                    className={`${styles.previewSpot} ${layoutCount === 6 ? styles[`sixSpot${spot.id}`] : styles[`tenSpot${spot.id}`]}`}
                    aria-label={`Spot ${spot.id}, ${spot.name}, ${spot.size}. ${formatMoney(spot.amount)}.`}
                  >
                    <strong>{spot.size}</strong><span>{formatMoney(spot.amount)}</span>
                  </button>
                ))}
                {specialSpot && <button type="button" className={`${styles.previewSpot} ${styles.specialPreview}`} aria-label={`Spot over the logo, Large. ${formatMoney(specialAmount)}.`}><strong>Large</strong><span>{formatMoney(specialAmount)}</span></button>}
              </div>
            )}
            <p>{layoutCount} spots · from {formatMoney(minimumPrice)}</p>
          </aside>
        </form>
      </main>

      <SiteFooter />
    </div>
  );
}

function PriceField({ label, dimensions, value, onChange }: { label: string; dimensions: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.priceField}>
      <span><strong>{label}</strong><small>{dimensions}</small></span>
      <em>Recommended</em>
      <span className={styles.priceInput}><input type="number" min="10" max="100000" value={value} onChange={(event) => onChange(event.target.value)} /><b>€</b></span>
    </label>
  );
}
