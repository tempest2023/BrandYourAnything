export type PublishAttempt = { fingerprint: string; idempotencyKey: string; closesAt: string };

export async function preparePublishAttempt(
  form: FormData,
  ownerIdentity: string,
  listingDays: number,
  previous: PublishAttempt | null,
  now = Date.now(),
): Promise<PublishAttempt> {
  const fields = await Promise.all([...form.entries()]
    .filter(([key]) => !["idempotencyKey", "auctionClosesAt"].includes(key))
    .map(async ([key, value]) => [key, typeof value === "string" ? value : {
      name: value.name, type: value.type, size: value.size,
      digest: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await value.arrayBuffer()))),
    }]));
  fields.sort(([left], [right]) => String(left).localeCompare(String(right)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([fields, ownerIdentity, listingDays])));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // The complete request, including its end date, is immutable on retry.
  // An expired saved request requires a deliberate edit/new request, not silently
  // changing its date under the same idempotency key.
  if (previous?.fingerprint === fingerprint && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous.idempotencyKey)
    && Number.isFinite(Date.parse(previous.closesAt))) return previous;
  return { fingerprint, idempotencyKey: crypto.randomUUID(), closesAt: new Date(now + listingDays * 86_400_000).toISOString() };
}
