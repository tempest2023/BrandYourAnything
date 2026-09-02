export type ManagedAuction = {
  slug: string;
  title: string;
  recoveryCode: string;
};

export const MANAGED_AUCTIONS_STORAGE_KEY = "brand-anything-managed-auctions-v2";
const LEGACY_MANAGER_KEY_STORAGE_KEY = "brand-anything-lid-manager-key";
const LEGACY_MANAGED_LID_STORAGE_KEY = "brand-anything-managed-lid";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const LEGACY_MANAGER_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_CODE_PATTERN = /^ba_mgr_[A-Za-z0-9_-]{43}$/;

export function isManagerRecoveryCode(value: string) {
  return LEGACY_MANAGER_KEY_PATTERN.test(value) || RECOVERY_CODE_PATTERN.test(value);
}

export function generateManagerRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `ba_mgr_${encoded}`;
}

function isManagedAuction(value: unknown): value is ManagedAuction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ManagedAuction>;
  return typeof candidate.slug === "string"
    && SLUG_PATTERN.test(candidate.slug)
    && typeof candidate.title === "string"
    && candidate.title.length >= 3
    && typeof candidate.recoveryCode === "string"
    && isManagerRecoveryCode(candidate.recoveryCode);
}

export function loadManagedAuctions() {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(MANAGED_AUCTIONS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isManagedAuction);
    } catch {
      try {
        window.localStorage.removeItem(MANAGED_AUCTIONS_STORAGE_KEY);
      } catch {
        return [];
      }
    }
  }

  let legacyAuction: string | null;
  let legacyManagerKey: string | null;
  try {
    legacyAuction = window.localStorage.getItem(LEGACY_MANAGED_LID_STORAGE_KEY);
    legacyManagerKey = window.localStorage.getItem(LEGACY_MANAGER_KEY_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!legacyAuction || !legacyManagerKey || !isManagerRecoveryCode(legacyManagerKey)) return [];
  try {
    const parsed = JSON.parse(legacyAuction) as { slug?: unknown; title?: unknown };
    const migrated = {
      slug: parsed.slug,
      title: parsed.title,
      recoveryCode: legacyManagerKey,
    };
    if (!isManagedAuction(migrated)) return [];
    saveManagedAuctions([migrated]);
    return [migrated];
  } catch {
    return [];
  }
}

export function saveManagedAuctions(auctions: ManagedAuction[]) {
  window.localStorage.setItem(MANAGED_AUCTIONS_STORAGE_KEY, JSON.stringify(auctions));
}

export function rememberManagedAuction(entry: ManagedAuction) {
  const auctions = loadManagedAuctions();
  const next = [entry, ...auctions.filter((auction) => auction.slug !== entry.slug)];
  saveManagedAuctions(next);
  return next;
}

export function forgetManagedAuction(slug: string) {
  const next = loadManagedAuctions().filter((auction) => auction.slug !== slug);
  saveManagedAuctions(next);
  return next;
}
