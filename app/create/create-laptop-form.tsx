"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/app/i18n-provider";
import { ModelStage } from "@/app/model-stage";
import type { BrandModelPreview, UploadedBrandModel } from "@/lib/brand-model";
import { LOCALES, type Locale } from "@/lib/i18n";
import {
  getPresetModel,
  type PresetModelId,
} from "@/lib/preset-models";
import { laptopPath, laptopUrl, SITE_HOST, SITE_URL } from "@/lib/site";
import {
  clampSurfaceSpotCount,
  MAX_SURFACE_SPOTS,
  MIN_SURFACE_SPOTS,
  surfaceSpotName,
  surfaceSpotSize,
  type SpotLayoutItem,
  type SurfaceModelAnalysis,
  type SurfacePlacementProfile,
  type SurfaceSpotPlacement,
} from "@/lib/surface-spots";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import { BrandAnythingSource, type AnythingSource } from "./brand-anything-source";
import styles from "./create.module.css";

const STEPS = ["Object", "Ownership", "Showcase", "Layout", "Prices", "Listing", "Placement", "Publish"] as const;
const DRAFT_STORAGE_KEY = "brand-anything-sell-draft";
const LEGACY_DRAFT_STORAGE_KEY = "brandmylaptop-sell-draft";
const PUBLISH_AFTER_AUTH_KEY = "brand-anything-publish-after-auth";
const MANAGER_KEY_STORAGE_KEY = "brand-anything-lid-manager-key";
const MANAGED_LID_STORAGE_KEY = "brand-anything-managed-lid";
const X_AUTH_STATUS_STORAGE_KEY = "brand-anything-x-auth-status";
const X_AUTH_STATUS_TTL_MS = 10 * 60 * 1000;
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
type PreviewSpot = {
  id: number;
  name: string;
  size: "Small" | "Medium" | "Large";
  price: PriceKey;
  premium?: number;
  position?: SurfaceSpotPlacement["position"];
  normal?: SurfaceSpotPlacement["normal"];
};
type Machine = "mac" | "pc" | "tesla" | "yacht" | "jet" | "anything";
type TeslaModel = "Model 3" | "Model Y" | "Model S" | "Model X" | "Cybertruck";
type ModelMode = "preset" | "custom";
type Ownership = "own" | "fund";
type LayoutCount = number;
type SellDraft = {
  step: number;
  furthestStep: number;
  machine: Machine;
  assetName: string;
  teslaModel: TeslaModel;
  modelMode: ModelMode;
  anythingSource: AnythingSource;
  brandModel: UploadedBrandModel | null;
  screenSize: 13 | 14 | 16;
  ownership: Ownership;
  machineCost: string;
  showcase: string[];
  extraNote: string;
  layoutCount: LayoutCount;
  surfaceSpots: SurfaceSpotPlacement[];
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

const TESLA_MODELS: TeslaModel[] = ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck"];

function defaultTitleFor(machine: Machine, teslaModel: TeslaModel) {
  if (machine === "mac") return "Your brand, on my Mac.";
  if (machine === "pc") return "Your brand, on my laptop.";
  if (machine === "tesla") return `Your brand, on my Tesla ${teslaModel}.`;
  if (machine === "yacht") return "Your brand, aboard my private yacht.";
  if (machine === "jet") return "Your brand, aboard my private jet.";
  return "Your brand, on my one-of-one object.";
}

function isDefaultListingTitle(value: string) {
  return (["mac", "pc", "yacht", "jet", "anything"] as const)
    .some((machine) => value === defaultTitleFor(machine, "Model 3"))
    || TESLA_MODELS.some((model) => value === defaultTitleFor("tesla", model));
}

function splitAddressHost(host: string) {
  const finalDot = host.lastIndexOf(".");
  if (finalDot <= 0) return { prefix: host, suffix: "/" };
  return {
    prefix: host.slice(0, finalDot),
    suffix: `${host.slice(finalDot)}/`,
  };
}

const ADDRESS_HOST = splitAddressHost(SITE_HOST);

function presetIdFor(machine: Machine, teslaModel: TeslaModel): PresetModelId | null {
  if (machine === "tesla" && teslaModel === "Cybertruck") return "tesla-cybertruck";
  if (machine === "tesla") return "tesla-model-3";
  if (machine === "yacht") return "flybridge-yacht";
  if (machine === "jet") return "private-jet";
  return null;
}

const OBJECT_PRESETS: Array<{
  id: Machine;
  title: string;
  description: string;
  icon: "laptop" | "pc" | "car" | "yacht" | "jet" | "anything";
}> = [
  { id: "mac", title: "Mac", description: "A familiar lid, ready for a finite set of sponsors.", icon: "laptop" },
  { id: "pc", title: "PC laptop", description: "A clean laptop lid without a maker mark in the preview.", icon: "pc" },
  { id: "tesla", title: "Tesla", description: "Every listed Tesla includes a ready-to-use 3D preview.", icon: "car" },
  { id: "yacht", title: "Private yacht", description: "Start with a licensed flybridge motor-yacht model.", icon: "yacht" },
  { id: "jet", title: "Private jet", description: "Start with a licensed long-range business-jet model.", icon: "jet" },
  { id: "anything", title: "Anything else", description: "Bring a robot, instrument, sculpture or another one-of-one object.", icon: "anything" },
];

function ObjectIcon({ kind }: { kind: (typeof OBJECT_PRESETS)[number]["icon"] }) {
  return (
    <span className={styles.objectIcon} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        {kind === "laptop" && <><rect x="6" y="6" width="20" height="15" rx="2" /><path d="M3.5 24.5h25M12 24.5l1-2h6l1 2" /></>}
        {kind === "pc" && <><rect x="5" y="7" width="22" height="14" rx="1.5" /><path d="M11 25h10M16 21v4" /></>}
        {kind === "car" && <><path d="M5 20.5h22l-1.8-6-4-3.5H11l-4.2 3.5L5 20.5Z" /><circle cx="10" cy="21" r="2.5" /><circle cx="22" cy="21" r="2.5" /><path d="M9 14.5h14" /></>}
        {kind === "yacht" && <><path d="M3.5 19.5h25l-4 6H9l-5.5-6Z" /><path d="M10 19.5l2-7h9l4 7M15 12.5V8l6 4.5" /><path d="M5 28c3-1.5 5-1.5 8 0 3-1.5 5-1.5 8 0 2-1 4-1.2 6 0" /></>}
        {kind === "jet" && <><path d="M4 18l10-3 4-10 3 1-2 9 8 3v2l-9-1-5 7-2-1 2-7-9 2v-2Z" /></>}
        {kind === "anything" && <><path d="M16 4v24M4 16h24M7.5 7.5l17 17M24.5 7.5l-17 17" /><circle cx="16" cy="16" r="4" /></>}
      </svg>
    </span>
  );
}

type ManagedLid = {
  slug: string;
  title: string;
};

type CreateResponse = {
  error?: string;
  location?: string;
  result?: { reason: string; slug: string };
};

type XAuthAvailability = "checking" | "available" | "unavailable" | "unknown";
type XAuthStatusResponse = {
  configured?: unknown;
  error?: string;
};
type CachedXAuthStatus = {
  configured: boolean;
  expiresAt: number;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function formatMoney(amount: number) {
  const rounded = Math.round(amount);
  if (rounded >= 1_000_000) {
    const millions = rounded / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1).replace(/\.0$/, "")}M €`;
  }
  if (rounded >= 10_000) {
    const thousands = rounded / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1).replace(/\.0$/, "")}K €`;
  }
  return `${moneyFormatter.format(rounded)} €`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 48);
}

function clampPrice(value: string, fallback: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function isSurfaceSpotPlacement(value: unknown): value is SurfaceSpotPlacement {
  if (!value || typeof value !== "object") return false;
  const spot = value as Partial<SurfaceSpotPlacement>;
  return Number.isInteger(spot.id)
    && Array.isArray(spot.position)
    && spot.position.length === 3
    && spot.position.every(Number.isFinite)
    && Array.isArray(spot.normal)
    && spot.normal.length === 3
    && spot.normal.every(Number.isFinite);
}

function isUnavailableXAuthError(message: string) {
  return /provider|not configured|not enabled|unsupported|disabled/i.test(message);
}

function readCachedXAuthStatus() {
  try {
    const raw = window.localStorage.getItem(X_AUTH_STATUS_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedXAuthStatus>;
    if (typeof cached.configured !== "boolean"
      || typeof cached.expiresAt !== "number"
      || !Number.isFinite(cached.expiresAt)
      || cached.expiresAt <= Date.now()) {
      window.localStorage.removeItem(X_AUTH_STATUS_STORAGE_KEY);
      return null;
    }
    return cached.configured;
  } catch {
    try {
      window.localStorage.removeItem(X_AUTH_STATUS_STORAGE_KEY);
    } catch {
      // A blocked storage API should not turn a successful backend check into a guess.
    }
    return null;
  }
}

function cacheXAuthStatus(configured: boolean) {
  const cached: CachedXAuthStatus = {
    configured,
    expiresAt: Date.now() + X_AUTH_STATUS_TTL_MS,
  };
  try {
    window.localStorage.setItem(X_AUTH_STATUS_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // The current request result remains usable; Publish will recheck without a cache flag.
  }
}

function clearCachedXAuthStatus() {
  try {
    window.localStorage.removeItem(X_AUTH_STATUS_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in hardened browser modes.
  }
}

async function fetchXAuthStatus(): Promise<boolean> {
  const response = await fetch("/api/auth/x-status", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json() as XAuthStatusResponse;
  if (!response.ok || typeof payload.configured !== "boolean") {
    throw new Error(payload.error || "X authentication availability could not be checked.");
  }
  return payload.configured;
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
          <a className={styles.builtBy} href="https://x.com/biIIIionaire" target="_blank" rel="noreferrer">
            <span>built by</span>
            <Image src="/github-avatar.jpeg" alt="" width={22} height={22} />
            <strong>Tempest</strong>
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
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href="https://x.com/biIIIionaire" target="_blank" rel="noreferrer">Contact</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function CreateLaptopForm() {
  const { locale } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const surfaceSpotsRef = useRef<SurfaceSpotPlacement[]>([]);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [machine, setMachine] = useState<Machine>("mac");
  const [assetName, setAssetName] = useState("My car");
  const [teslaModel, setTeslaModel] = useState<TeslaModel>("Model 3");
  const [modelMode, setModelMode] = useState<ModelMode>("preset");
  const [anythingSource, setAnythingSource] = useState<AnythingSource>("model");
  const [brandModel, setBrandModel] = useState<UploadedBrandModel | null>(null);
  const [brandModelPreview, setBrandModelPreview] = useState<BrandModelPreview | null>(null);
  const [screenSize, setScreenSize] = useState<13 | 14 | 16>(14);
  const [ownership, setOwnership] = useState<Ownership>("own");
  const [machineCost, setMachineCost] = useState("");
  const [showcase, setShowcase] = useState<string[]>(SHOWCASE_OPTIONS.slice(0, 5));
  const [extraNote, setExtraNote] = useState("");
  const [layoutCount, setLayoutCount] = useState<LayoutCount>(10);
  const [surfaceAnalysis, setSurfaceAnalysis] = useState<SurfaceModelAnalysis | null>(null);
  const [surfaceSpots, setSurfaceSpots] = useState<SurfaceSpotPlacement[]>([]);
  const [selectedSurfaceSpotId, setSelectedSurfaceSpotId] = useState(1);
  const [placementMessage, setPlacementMessage] = useState("");
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
  const [xAuthAvailability, setXAuthAvailability] = useState<XAuthAvailability>("checking");
  const xAuthRequestRef = useRef<Promise<boolean> | null>(null);
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
    surfaceSpotsRef.current = surfaceSpots;
  }, [surfaceSpots]);

  const resolveXAuthAvailability = useCallback(async () => {
    const cached = readCachedXAuthStatus();
    if (cached !== null) {
      setXAuthAvailability(cached ? "available" : "unavailable");
      return cached;
    }

    setXAuthAvailability("checking");
    const request = xAuthRequestRef.current ?? fetchXAuthStatus();
    xAuthRequestRef.current = request;
    try {
      const configured = await request;
      cacheXAuthStatus(configured);
      setXAuthAvailability(configured ? "available" : "unavailable");
      return configured;
    } catch {
      setXAuthAvailability("unknown");
      return null;
    } finally {
      if (xAuthRequestRef.current === request) xAuthRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void resolveXAuthAvailability(), 0);
    return () => window.clearTimeout(timer);
  }, [resolveXAuthAvailability]);

  useEffect(() => {
    if (step !== STEPS.length - 1 || readCachedXAuthStatus() !== null) return;
    const timer = window.setTimeout(() => void resolveXAuthAvailability(), 0);
    return () => window.clearTimeout(timer);
  }, [resolveXAuthAvailability, step]);

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
        if (draft.teslaModel && TESLA_MODELS.includes(draft.teslaModel)) setTeslaModel(draft.teslaModel);
        if (draft.modelMode === "preset" || draft.modelMode === "custom") setModelMode(draft.modelMode);
        if (draft.anythingSource) setAnythingSource(draft.anythingSource);
        if (draft.brandModel
          && typeof draft.brandModel.storagePath === "string"
          && typeof draft.brandModel.uploadClaim === "string"
          && typeof draft.brandModel.fileName === "string"
          && typeof draft.brandModel.size === "number") {
          setBrandModel(draft.brandModel);
          setModelMode("custom");
        }
        if (draft.screenSize) setScreenSize(draft.screenSize);
        if (draft.ownership) setOwnership(draft.ownership);
        if (typeof draft.machineCost === "string") setMachineCost(draft.machineCost);
        if (Array.isArray(draft.showcase)) setShowcase(draft.showcase);
        if (typeof draft.extraNote === "string") setExtraNote(draft.extraNote);
        if (Number.isInteger(draft.layoutCount)
          && draft.layoutCount! >= MIN_SURFACE_SPOTS
          && draft.layoutCount! <= MAX_SURFACE_SPOTS) setLayoutCount(draft.layoutCount!);
        if (Array.isArray(draft.surfaceSpots) && draft.surfaceSpots.every(isSurfaceSpotPlacement)) {
          setSurfaceSpots(draft.surfaceSpots.slice(0, MAX_SURFACE_SPOTS));
        }
        if (typeof draft.smallPrice === "string") setSmallPrice(draft.smallPrice);
        if (typeof draft.mediumPrice === "string") setMediumPrice(draft.mediumPrice);
        if (typeof draft.largePrice === "string") setLargePrice(draft.largePrice);
        if (typeof draft.specialSpot === "boolean") setSpecialSpot(draft.specialSpot);
        if (typeof draft.specialPrice === "string") setSpecialPrice(draft.specialPrice);
        if (draft.listingDays) setListingDays(draft.listingDays);
        if (draft.stickerMonths) setStickerMonths(draft.stickerMonths);
        if (typeof draft.title === "string") {
          const draftMachine = draft.machine ?? "mac";
          const draftTeslaModel = draft.teslaModel && TESLA_MODELS.includes(draft.teslaModel)
            ? draft.teslaModel
            : "Model 3";
          setTitle(isDefaultListingTitle(draft.title)
            ? defaultTitleFor(draftMachine, draftTeslaModel)
            : draft.title);
        }
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
      teslaModel,
      modelMode,
      anythingSource,
      brandModel,
      screenSize,
      ownership,
      machineCost,
      showcase,
      extraNote,
      layoutCount,
      surfaceSpots,
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
  }, [anythingSource, assetName, brandModel, draftReady, extraNote, furthestStep, largePrice, layoutCount, listingDays, machine, machineCost, mediumPrice, modelMode, ownership, screenSize, showcase, slug, smallPrice, specialPrice, specialSpot, step, stickerMonths, surfaceSpots, teslaModel, title]);

  useEffect(() => {
    let active = true;
    const callbackParameters = new URLSearchParams([
      window.location.search.replace(/^\?/, ""),
      window.location.hash.replace(/^#/, ""),
    ].filter(Boolean).join("&"));
    const callbackError = callbackParameters.get("error_description")
      || callbackParameters.get("error_code")
      || (callbackParameters.get("error") ? "X did not complete sign in. Please try again." : "");

    if (xAuthAvailability === "checking" || xAuthAvailability === "unknown") {
      const timer = window.setTimeout(() => {
        if (active) setAuthReady(false);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }

    if (xAuthAvailability === "unavailable" || !isSupabaseBrowserConfigured()) {
      const timer = window.setTimeout(() => {
        if (!active) return;
        window.sessionStorage.removeItem(PUBLISH_AFTER_AUTH_KEY);
        setAuthReady(true);
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
        if (isUnavailableXAuthError(message)) {
          cacheXAuthStatus(false);
          setXAuthAvailability("unavailable");
        }
        setErrorMessage(message);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [xAuthAvailability]);

  const isAnything = machine !== "mac" && machine !== "pc";
  const selectedPresetId = presetIdFor(machine, teslaModel);
  const selectedPreset = getPresetModel(selectedPresetId);
  const usingPresetModel = Boolean(selectedPreset && modelMode === "preset");
  const previewModel = usingPresetModel && selectedPreset
    ? { sourceUrl: selectedPreset.publicPath, format: "glb" as const }
    : brandModelPreview;
  const placementProfile: SurfacePlacementProfile = machine === "tesla"
    ? "car"
    : machine === "yacht"
      ? "yacht"
      : machine === "jet"
        ? "jet"
        : "generic";
  const prices = useMemo(() => ({
    small: clampPrice(smallPrice, layoutCount >= 9 ? 125 : 250),
    medium: clampPrice(mediumPrice, layoutCount >= 9 ? 200 : 400),
    large: clampPrice(largePrice, layoutCount >= 9 ? 400 : 800),
  }), [largePrice, layoutCount, mediumPrice, smallPrice]);

  const baseSpots: PreviewSpot[] = isAnything
    ? Array.from({ length: layoutCount }, (_, index) => {
      const placement = surfaceSpots.find((spot) => spot.id === index + 1);
      const size = surfaceSpotSize(index, layoutCount);
      return {
        id: index + 1,
        name: placement ? surfaceSpotName(placement, index) : `Surface spot ${index + 1}`,
        size: size === "L" ? "Large" : size === "M" ? "Medium" : "Small",
        price: size === "L" ? "large" : size === "M" ? "medium" : "small",
        ...(placement ? { position: placement.position, normal: placement.normal } : {}),
      };
    })
    : [...(layoutCount === 10 ? TEN_SPOTS : SIX_SPOTS)];
  const previewSpots = baseSpots.map((spot) => ({
    ...spot,
    amount: Math.round(prices[spot.price] * (spot.premium ?? 1)),
  }));
  const spotCountBySize = {
    large: previewSpots.filter((spot) => spot.price === "large").length,
    medium: previewSpots.filter((spot) => spot.price === "medium").length,
    small: previewSpots.filter((spot) => spot.price === "small").length,
  };
  const specialAmount = clampPrice(specialPrice, 1500);
  const hasSpecialSpot = machine === "mac" && specialSpot;
  const totalFloor = previewSpots.reduce((sum, spot) => sum + spot.amount, 0) + (hasSpecialSpot ? specialAmount : 0);
  const minimumPrice = Math.min(...previewSpots.map((spot) => spot.amount));
  const fundingCost = Number(machineCost);
  const needsCustomModel = isAnything && !usingPresetModel;
  const objectName = isAnything ? assetName.trim() || "your object" : `${machine === "mac" ? "Mac" : "PC"} · ${screenSize}″`;
  const machineIsValid = ownership === "own" || (Number.isFinite(fundingCost) && fundingCost >= 1);
  const objectIsValid = !isAnything || (assetName.trim().length >= 2 && (usingPresetModel || brandModel !== null));
  const layoutIsValid = !isAnything || (surfaceSpots.length === layoutCount
    && surfaceSpots.every((spot) => spot.position.length === 3 && spot.normal.length === 3));
  const desiredPublicLocation = laptopPath(slug);
  const sharePost = X_SHARE_POSTS[shareLocale](laptopUrl(slug), objectName, isAnything);

  const selectLayout = (count: LayoutCount) => {
    setLayoutCount(count);
    if (count >= 9) {
      setSmallPrice("125");
      setMediumPrice("200");
      setLargePrice("400");
    } else {
      setSmallPrice("250");
      setMediumPrice("400");
      setLargePrice("800");
    }
  };

  const updateSurfaceSpotCount = (requestedCount: number) => {
    const availableCount = surfaceAnalysis?.placements.length || MAX_SURFACE_SPOTS;
    const count = Math.min(availableCount, clampSurfaceSpotCount(requestedCount));
    setLayoutCount(count);
    setSurfaceSpots((current) => Array.from({ length: count }, (_, index) => (
      current.find((spot) => spot.id === index + 1)
      ?? surfaceAnalysis?.placements.find((spot) => spot.id === index + 1)
      ?? current[index % Math.max(current.length, 1)]
      ?? { id: index + 1, position: [0, 0, 0], normal: [0, 0, 1] }
    )).map((spot, index) => ({ ...spot, id: index + 1 })));
    setSelectedSurfaceSpotId((current) => Math.min(current, count));
    setPlacementMessage("");
  };

  const handleModelAnalysis = (analysis: SurfaceModelAnalysis) => {
    setSurfaceAnalysis(analysis);
    if (surfaceSpotsRef.current.length > 0) return;
    const count = Math.min(analysis.recommendedCount, analysis.placements.length);
    setLayoutCount(count);
    setSurfaceSpots(analysis.placements.slice(0, count));
    setSelectedSurfaceSpotId(1);
  };

  const resetSurfaceLayout = () => {
    if (!surfaceAnalysis) return;
    const count = Math.min(surfaceAnalysis.recommendedCount, surfaceAnalysis.placements.length);
    setLayoutCount(count);
    setSurfaceSpots(surfaceAnalysis.placements.slice(0, count));
    setSelectedSurfaceSpotId(1);
    setPlacementMessage("Recommended side-surface layout restored.");
  };

  const placeSurfaceSpot = (nextSpot: SurfaceSpotPlacement) => {
    setSurfaceSpots((current) => current.map((spot) => spot.id === nextSpot.id ? nextSpot : spot));
    setPlacementMessage(`Spot ${nextSpot.id} moved to this surface.`);
  };

  const clearSurfaceLayout = () => {
    surfaceSpotsRef.current = [];
    setSurfaceAnalysis(null);
    setSurfaceSpots([]);
    setSelectedSurfaceSpotId(1);
    setPlacementMessage("");
  };

  const selectObjectPreset = (nextMachine: Machine) => {
    if (nextMachine === machine) return;
    const nextPresetId = presetIdFor(nextMachine, teslaModel);
    setBrandModel(null);
    setBrandModelPreview(null);
    clearSurfaceLayout();
    setModelMode(nextPresetId ? "preset" : "custom");
    setMachine(nextMachine);
    setTitle((current) => isDefaultListingTitle(current)
      ? defaultTitleFor(nextMachine, teslaModel)
      : current);
    setSpecialSpot(nextMachine === "mac");
    if (nextMachine === "tesla") setAssetName(`Tesla ${teslaModel}`);
    if (nextMachine === "yacht") setAssetName("Flybridge motor yacht");
    if (nextMachine === "jet") setAssetName("Long-range private jet");
    if (nextMachine === "anything" && /^(My car|Tesla |Azimut Fly 68|Gulfstream G700|Flybridge motor yacht|Long-range private jet)/.test(assetName)) {
      setAssetName("My object");
    }
  };

  const selectTeslaModel = (model: TeslaModel) => {
    setBrandModel(null);
    setBrandModelPreview(null);
    clearSurfaceLayout();
    setModelMode(presetIdFor("tesla", model) ? "preset" : "custom");
    setTeslaModel(model);
    setTitle((current) => isDefaultListingTitle(current)
      ? defaultTitleFor("tesla", model)
      : current);
    setAssetName(`Tesla ${model}`);
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
    if (step === 3 && !layoutIsValid) return;
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
    const spotLayout: SpotLayoutItem[] = previewSpots.map((spot) => ({
      id: spot.id,
      name: spot.name,
      size: spot.size === "Large" ? "L" : spot.size === "Medium" ? "M" : "S",
      dimensions: isAnything
        ? `${spot.size} side-surface placement`
        : spot.size === "Large" ? "9.5 × 5.5 cm" : spot.size === "Medium" ? "9.5 × 4 cm" : "4.5 × 4.5 cm",
      openingBidCents: Math.round(spot.amount * 100),
      ...(spot.position && spot.normal ? { position: spot.position, normal: spot.normal } : {}),
    }));
    formData.set("layoutCount", String(layoutCount));
    formData.set("spotLayout", JSON.stringify(spotLayout));
    if (brandModel && isAnything) {
      formData.set("modelStoragePath", brandModel.storagePath);
      formData.set("modelUploadClaim", brandModel.uploadClaim);
      formData.set("modelFileName", brandModel.fileName);
      formData.set("modelFileSize", String(brandModel.size));
    } else if (usingPresetModel && selectedPreset) {
      formData.set("presetModelId", selectedPreset.id);
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
    if (!machineIsValid || !layoutIsValid || !objectIsValid) {
      setErrorMessage("Please complete all required steps before publishing.");
      return;
    }
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

    if (!machineIsValid || !layoutIsValid || !objectIsValid) {
      setErrorMessage("Please complete all required steps before publishing.");
      return;
    }

    if (readCachedXAuthStatus() !== true || xAuthAvailability !== "available") {
      await resolveXAuthAvailability();
      return;
    }

    if (!authReady) {
      setErrorMessage("Checking your X session. Please try again in a moment.");
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
      } catch (error) {
        window.sessionStorage.removeItem(PUBLISH_AFTER_AUTH_KEY);
        setAuthRedirecting(false);
        const message = error instanceof Error ? error.message : "X sign-in could not be started.";
        if (isUnavailableXAuthError(message)) {
          cacheXAuthStatus(false);
          setXAuthAvailability("unavailable");
          setErrorMessage("");
        } else {
          clearCachedXAuthStatus();
          setXAuthAvailability("unknown");
          setErrorMessage(message);
        }
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
          {xAuthAvailability === "unavailable" ? managedLid && (
            <p className={styles.signIn}>Your auction is saved in this browser. <Link href={laptopPath(managedLid.slug)}>Manage {managedLid.title}</Link>.</p>
          ) : xAuthAvailability === "available" ? (
            <p className={styles.signIn}>Already published an auction? <Link href="/">Sign in to manage it</Link>.</p>
          ) : null}

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

        <form
          ref={formRef}
          className={`${styles.wizardGrid} ${step === 0 ? styles.objectStepGrid : ""}`}
          onSubmit={handleSubmit}
        >
          <section className={styles.formPanel} aria-live="polite">
            {step === 0 && (
              <fieldset>
                <legend>What are you selling space on?</legend>
                <div className={styles.objectCards}>
                  {OBJECT_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={machine === preset.id ? styles.selectedObjectCard : styles.objectCard}
                      aria-pressed={machine === preset.id}
                      onClick={() => selectObjectPreset(preset.id)}
                    >
                      <ObjectIcon kind={preset.icon} />
                      <span className={styles.objectCardCopy}>
                        <strong>{preset.title}</strong>
                        <small>{preset.description}</small>
                      </span>
                      <span className={styles.objectSelectedMark} aria-hidden="true">✓</span>
                    </button>
                  ))}
                </div>
                {machine === "tesla" && (
                  <div className={styles.modelPicker} role="group" aria-label="Tesla model">
                    <span>Choose your Tesla</span>
                    <div>
                      {TESLA_MODELS.map((model) => (
                        <button
                          type="button"
                          key={model}
                          className={teslaModel === model ? styles.selectedModelChoice : styles.modelChoice}
                          aria-pressed={teslaModel === model}
                          onClick={() => selectTeslaModel(model)}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {isAnything ? (
                  <>
                    {usingPresetModel && selectedPreset ? (
                      <section className={styles.includedModel} aria-labelledby="included-model-title">
                        <div>
                          <p>3D model included</p>
                          <h2 id="included-model-title">{selectedPreset.assetName}</h2>
                          <span>
                            Ready for the auction preview. You can still replace it with an exact model you own.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setBrandModel(null);
                            setBrandModelPreview(null);
                            clearSurfaceLayout();
                            setModelMode("custom");
                          }}
                        >
                          Upload my own model
                        </button>
                      </section>
                    ) : (
                      <>
                        {selectedPreset && (
                          <button
                            type="button"
                            className={styles.useIncludedModel}
                            onClick={() => {
                              setBrandModel(null);
                              setBrandModelPreview(null);
                              clearSurfaceLayout();
                              setModelMode("preset");
                              setAssetName(selectedPreset.assetName);
                            }}
                          >
                            ← Use the included {selectedPreset.assetName} model
                          </button>
                        )}
                        {!selectedPreset && machine === "tesla" && (
                          <p className={styles.customModelNote}>
                            This exact Tesla trim is not bundled with a redistributable model. Upload a model you have the right to use.
                          </p>
                        )}
                        <BrandAnythingSource
                          assetName={assetName}
                          onAssetNameChange={setAssetName}
                          source={anythingSource}
                          onSourceChange={setAnythingSource}
                          model={brandModel}
                          onModelChange={setBrandModel}
                          onPreviewChange={(preview) => {
                            setBrandModelPreview(preview);
                            clearSurfaceLayout();
                          }}
                          getUploadHeaders={() => ({ "X-Lid-Manager-Key": getOrCreateManagerKey() })}
                        />
                      </>
                    )}
                  </>
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
                {ownership === "fund" && <label className={styles.inputLabel}>What does the machine cost?<span className={styles.moneyField}><input type="number" min="1" value={machineCost} onChange={(event) => setMachineCost(event.target.value)} /><b>€</b></span><small>The maker&apos;s own price for the exact machine, so the bar means something.</small></label>}
                {!machineIsValid && <p className={styles.validation} role="alert">Give what the machine costs.</p>}
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
                <legend>{isAnything ? "Place your brand spots" : "How many spots?"}</legend>
                {isAnything ? (
                  <div className={styles.surfaceLayoutControls}>
                    <div className={styles.surfaceRecommendation}>
                      <span>Side-surface analysis</span>
                      <strong>{surfaceAnalysis ? `${surfaceAnalysis.recommendedCount} spots recommended` : "Analysing your model…"}</strong>
                      <p>We measure usable outward-facing surfaces and exclude the top and bottom. {placementProfile === "car" ? "Cars start with doors, quarter panels, front and rear." : placementProfile === "yacht" ? "Yachts start with port, starboard, bow and stern zones." : placementProfile === "jet" ? "Aircraft start with both fuselage sides, nose and tail zones." : "The first layout spreads placements across distinct side faces."}</p>
                    </div>
                    <label className={styles.spotCountControl}>
                      <span>Number of spots</span>
                      <span className={styles.spotStepper}>
                        <button type="button" aria-label="Remove one spot" disabled={layoutCount <= MIN_SURFACE_SPOTS} onClick={() => updateSurfaceSpotCount(layoutCount - 1)}>−</button>
                        <input
                          type="number"
                          min={MIN_SURFACE_SPOTS}
                          max={surfaceAnalysis?.placements.length || MAX_SURFACE_SPOTS}
                          value={layoutCount}
                          onChange={(event) => updateSurfaceSpotCount(Number(event.target.value))}
                          aria-describedby="spot-count-note"
                        />
                        <button type="button" aria-label="Add one spot" disabled={layoutCount >= (surfaceAnalysis?.placements.length || MAX_SURFACE_SPOTS)} onClick={() => updateSurfaceSpotCount(layoutCount + 1)}>+</button>
                      </span>
                    </label>
                    <p id="spot-count-note" className={styles.surfaceHint}>Select a numbered spot, then click a side surface in the 3D preview to move it.</p>
                    <div className={styles.spotSelector} role="group" aria-label="Surface spots">
                      {surfaceSpots.slice(0, layoutCount).map((spot) => (
                        <button
                          type="button"
                          key={spot.id}
                          className={selectedSurfaceSpotId === spot.id ? styles.activeSpotChip : styles.spotChip}
                          aria-pressed={selectedSurfaceSpotId === spot.id}
                          onClick={() => {
                            setSelectedSurfaceSpotId(spot.id);
                            setPlacementMessage(`Spot ${spot.id} selected. Click its new side surface in the preview.`);
                          }}
                        >
                          <span>{String(spot.id).padStart(2, "0")}</span>
                          {surfaceSpotSize(spot.id - 1, layoutCount) === "L" ? "Hero" : surfaceSpotSize(spot.id - 1, layoutCount) === "M" ? "Profile" : "Detail"}
                        </button>
                      ))}
                    </div>
                    <div className={styles.surfaceLayoutFooter}>
                      <p role="status" aria-live="polite">{placementMessage || "Drag to orbit. Clicking without dragging places the selected spot."}</p>
                      <button type="button" disabled={!surfaceAnalysis} onClick={resetSurfaceLayout}>Reset recommended layout</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.stackedCards}>
                    <button type="button" className={layoutCount === 10 ? styles.selectedCard : styles.optionCard} aria-pressed={layoutCount === 10} onClick={() => selectLayout(10)}><strong>Ten spots</strong><span>Three banners, four small marks around the logo, three strips. The most inventory, the lowest entry price.</span></button>
                    <button type="button" className={layoutCount === 6 ? styles.selectedCard : styles.optionCard} aria-pressed={layoutCount === 6} onClick={() => selectLayout(6)}><strong>Six spots</strong><span>Fewer, larger placements. Each sponsor gets more of the lid, and the whole thing sells in fewer deals.</span></button>
                  </div>
                )}
              </fieldset>
            )}

            {step === 4 && (
              <fieldset>
                <legend>What does a spot start at?</legend>
                <p className={styles.introCopy}>Set a starting price for each placement size. The amount shown on every spot updates as you type.</p>
                <div className={styles.priceList}>
                  <PriceField label={`${spotCountBySize.large} × Large`} dimensions={isAnything ? "Hero placement" : "9.5 × 5.5 cm printed"} value={largePrice} onChange={setLargePrice} />
                  <PriceField label={`${spotCountBySize.medium} × Medium`} dimensions={isAnything ? "Profile placement" : "9.5 × 4 cm printed"} value={mediumPrice} onChange={setMediumPrice} />
                  <PriceField label={`${spotCountBySize.small} × Small`} dimensions={isAnything ? "Detail placement" : "4.5 × 4.5 cm printed"} value={smallPrice} onChange={setSmallPrice} />
                </div>
                {machine === "mac" && (
                  <label className={specialSpot ? styles.checkedSpecial : styles.specialSpot}>
                    <input type="checkbox" checked={specialSpot} onChange={(event) => setSpecialSpot(event.target.checked)} />
                    <span><strong>Add a special spot over the logo</strong><small>6 × 6 cm, covering the Apple mark in the middle of the lid. Name your own price — it is the one placement size says nothing about.</small></span>
                    {specialSpot && <span className={styles.specialPrice}><small>Starts at</small><span><input type="number" min="1" value={specialPrice} onChange={(event) => setSpecialPrice(event.target.value)} /><b>€</b></span></span>}
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
                <label className={styles.inputLabel}>Title<input type="text" value={title} minLength={3} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder={defaultTitleFor(machine, teslaModel)} required /></label>
                <label className={styles.inputLabel}>Address<span className={styles.addressField}><span className={styles.addressHost} title={`${SITE_HOST}/`}><b>{ADDRESS_HOST.prefix}</b><strong>{ADDRESS_HOST.suffix}</strong></span><input value={slug} minLength={3} maxLength={48} onChange={(event) => setSlug(slugify(event.target.value))} placeholder="your-name" required /><i aria-label="Address is available">✓</i></span></label>
                <dl className={styles.summary}>
                  <div><dt>Object</dt><dd>{objectName}</dd></div>
                  <div><dt>Ownership</dt><dd>{ownership === "own" ? "You own it" : `Funding ${formatMoney(fundingCost || 0)}`}</dd></div>
                  <div><dt>Layout</dt><dd>{layoutCount + (hasSpecialSpot ? 1 : 0)} spots{hasSpecialSpot ? ", logo covered" : ""}</dd></div>
                  <div><dt>If it all sells</dt><dd>{formatMoney(totalFloor)}</dd></div>
                  <div><dt>Runs for</dt><dd>{listingDays} days</dd></div>
                  <div><dt>Stickers stay</dt><dd>{stickerMonths} months</dd></div>
                </dl>
                <p className={styles.publishCopy}>Buyers pay you directly — the money lands in your own Stripe account, minus the 10% platform fee and Stripe&apos;s processing fees. You produce each placement to the agreed spec and approve every logo before it appears.</p>
                {xAuthAvailability === "unavailable" ? (
                  <section className={styles.shareFallback} aria-labelledby="x-share-title">
                    <h2 id="x-share-title">Share your auction.</h2>
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
                ) : xAuthAvailability === "available" ? (
                  <>
                    {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
                    <button className={styles.publishButton} type="submit" disabled={!authReady || submitting || authRedirecting}>
                      {submitting ? "Publishing…" : authRedirecting ? "Opening X…" : accessToken ? "Publish your auction" : "Sign in with X and publish"}
                    </button>
                    <p className={styles.authNote}>X is what a buyer checks before putting their logo on a stranger&apos;s {isAnything ? "object" : "laptop"}. Everything above is kept while you sign in; you land back here.</p>
                  </>
                ) : (
                  <section className={styles.shareFallback} aria-labelledby="x-status-title">
                    <h2 id="x-status-title">{xAuthAvailability === "checking" ? "Checking publishing options…" : "We couldn’t check X sign-in."}</h2>
                    <p className={styles.shareNote}>{xAuthAvailability === "checking"
                      ? "This normally takes a moment."
                      : "Check your connection and try again. No login option will be shown until the check succeeds."}</p>
                    {xAuthAvailability === "unknown" && (
                      <button type="button" className={styles.publishButton} onClick={() => void resolveXAuthAvailability()}>Check again</button>
                    )}
                  </section>
                )}
              </fieldset>
            )}

            {step < 7 && <div className={styles.actions}>{step > 0 && <button type="button" className={styles.backButton} onClick={backStep}>Back</button>}<button type="button" className={styles.continueButton} disabled={(step === 0 && !objectIsValid) || (step === 1 && !machineIsValid) || (step === 3 && !layoutIsValid)} onClick={continueStep}>{step === 0 && needsCustomModel && !brandModel ? "Upload a 3D model to continue" : step === 3 && !layoutIsValid ? "Analysing model surfaces…" : "Continue"}</button></div>}
          </section>

          <aside className={styles.previewColumn} aria-label={`${objectName} auction preview`}>
            {isAnything ? (
              previewModel ? (
                <div className={styles.presetPreview}>
                  <ModelStage
                    sourceUrl={previewModel.sourceUrl}
                    format={previewModel.format}
                    label={`${objectName} interactive 3D auction preview`}
                    className={styles.presetModelStage}
                    spots={previewSpots.map((spot) => ({
                      id: spot.id,
                      ...(spot.position ? { position: spot.position, normal: spot.normal } : {}),
                    }))}
                    placementProfile={placementProfile}
                    editing={step === 3}
                    selectedSpotId={step === 3 ? selectedSurfaceSpotId : undefined}
                    onSelectSpot={step === 3 ? (spotId) => {
                      setSelectedSurfaceSpotId(spotId);
                      setPlacementMessage(`Spot ${spotId} selected. Click its new side surface in the preview.`);
                    } : undefined}
                    onModelAnalysis={handleModelAnalysis}
                    onPlaceSpot={placeSurfaceSpot}
                    onPlacementError={setPlacementMessage}
                  />
                  {usingPresetModel && selectedPreset && (
                    <p className={styles.presetAttribution}>
                      Model by <a href={selectedPreset.sourceUrl} target="_blank" rel="noreferrer">{selectedPreset.author}</a>
                      {" · "}<a href={selectedPreset.licenseUrl} target="_blank" rel="noreferrer">{selectedPreset.licenseName}</a>
                      {(selectedPreset.id === "flybridge-yacht" || selectedPreset.id === "private-jet") && (
                        <span>Representative preview — not an official manufacturer digital twin.</span>
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <div className={styles.anythingMiniStage}>
                  <span className={styles.miniOrbit} aria-hidden="true" />
                  <div className={styles.miniObject} data-kind={machine} aria-hidden="true"><i /><i /><i /></div>
                  <strong>{objectName}</strong>
                  <small>{brandModel ? `${brandModel.fileName} · uploaded — choose it again to edit the layout` : "Your 3D model appears here"}</small>
                </div>
              )
            ) : (
              <div className={`${styles.lid} ${layoutCount === 6 ? styles.sixLid : styles.tenLid}`}>
                {machine === "mac" && <Image className={styles.apple} src="/apple-logo.svg" alt="" width={160} height={160} />}
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
                {hasSpecialSpot && <button type="button" className={`${styles.previewSpot} ${styles.specialPreview}`} aria-label={`Spot over the logo, Large. ${formatMoney(specialAmount)}.`}><strong>Large</strong><span>{formatMoney(specialAmount)}</span></button>}
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
      <span className={styles.priceInput}><input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} /><b>€</b></span>
    </label>
  );
}
