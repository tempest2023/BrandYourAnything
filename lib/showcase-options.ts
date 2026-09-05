export type ShowcaseMachine = "mac" | "pc" | "tesla" | "yacht" | "jet" | "anything";

export type ShowcaseOptionGroup = {
  label: string;
  options: readonly string[];
};

export const MAX_CUSTOM_SHOWCASE_LENGTH = 80;

const LAPTOP_SHOWCASE_GROUPS: readonly ShowcaseOptionGroup[] = [
  {
    label: "While carried",
    options: [
      "Business travel",
      "Public transit, airports and shared spaces",
    ],
  },
  {
    label: "Where it is used",
    options: [
      "Coworking spaces and cafés",
      "Conferences and meetups",
      "Client and investor meetings",
      "Campuses and universities",
      "Posts, livestreams and videos",
    ],
  },
];

export const SHOWCASE_GROUPS_BY_MACHINE: Record<ShowcaseMachine, readonly ShowcaseOptionGroup[]> = {
  mac: LAPTOP_SHOWCASE_GROUPS,
  pc: LAPTOP_SHOWCASE_GROUPS,
  tesla: [
    {
      label: "On the road",
      options: [
        "Daily commutes and city driving",
        "Road trips and highway travel",
        "Client, guest and passenger trips",
      ],
    },
    {
      label: "When parked",
      options: [
        "Office and coworking car parks",
        "EV charging stations",
        "Shopping districts and public car parks",
        "Car meets, shows and conferences",
        "Posts, livestreams and videos",
      ],
    },
  ],
  yacht: [
    {
      label: "Underway",
      options: [
        "Coastal cruising and open-water trips",
        "Guest, client and charter outings",
        "Regattas and organized sailing events",
      ],
    },
    {
      label: "When docked",
      options: [
        "Marinas and yacht clubs",
        "Harbours and waterfront destinations",
        "Boat shows and marine events",
        "Resorts, beach clubs and hospitality venues",
        "Posts, livestreams and videos",
      ],
    },
  ],
  jet: [
    {
      label: "In flight",
      options: [
        "Domestic and international routes",
        "Client, executive and charter flights",
        "Media and production trips",
      ],
    },
    {
      label: "On the ground",
      options: [
        "FBO terminals and private airports",
        "Airport aprons and hangars",
        "Aviation shows and industry events",
        "Business travel hubs",
        "Posts, livestreams and videos",
      ],
    },
  ],
  anything: [
    {
      label: "In use",
      options: [
        "Everyday use in public",
        "Travel and transit",
        "Client, team and community activities",
      ],
    },
    {
      label: "When displayed",
      options: [
        "Workplaces and visitor-facing venues",
        "Conferences, exhibitions and pop-ups",
        "Retail, hospitality and public spaces",
        "Posts, livestreams and videos",
      ],
    },
  ],
};

export function showcaseOptionsFor(machine: ShowcaseMachine) {
  return SHOWCASE_GROUPS_BY_MACHINE[machine].flatMap((group) => group.options);
}

export function sanitizeCustomShowcase(value: string) {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N}\s&(),./-]/gu, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-");
  return Array.from(sanitized).slice(0, MAX_CUSTOM_SHOWCASE_LENGTH).join("");
}

export function normalizeCustomShowcase(value: string) {
  return sanitizeCustomShowcase(value).trim();
}

export function isValidCustomShowcase(value: string) {
  const normalized = normalizeCustomShowcase(value);
  return normalized.length >= 2 && normalized === value.trim();
}
