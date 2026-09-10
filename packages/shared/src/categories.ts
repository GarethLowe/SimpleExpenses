export const DEFAULT_CATEGORIES = [
  "Travel",
  "Fuel",
  "Parking",
  "Meals",
  "Accommodation",
  "Office Supplies",
  "Software & Subscriptions",
  "Equipment",
  "Telephone & Internet",
  "Professional Services",
  "Training",
  "Marketing",
  "Utilities",
  "Insurance",
  "Entertainment",
  "Groceries",
  "Other",
] as const;

export const DEFAULT_SETTINGS = {
  companies: ["Personal"],
  categories: [...DEFAULT_CATEGORIES],
  defaultCurrency: "GBP",
  defaultCompany: "Personal",
};

const KEYWORDS: Array<[category: string, patterns: RegExp]> = [
  ["Fuel", /\b(shell|bp|esso|texaco|petrol|diesel|fuel|unleaded|gulf|jet)\b/i],
  ["Parking", /\b(parking|ncp|ringgo|justpark|car park|apcoa)\b/i],
  ["Travel", /\b(rail|train|trainline|uber|bolt|taxi|airline|airways|easyjet|ryanair|ba\.com|tfl|oyster|bus|ferry|flight|toll|national express)\b/i],
  ["Accommodation", /\b(hotel|premier inn|travelodge|airbnb|booking\.com|hilton|marriott|ibis|lodge|inn)\b/i],
  ["Meals", /\b(restaurant|cafe|caf[eé]|coffee|costa|starbucks|pret|greggs|mcdonald|kfc|nando|pizza|bistro|deli|bar & grill|pub|kitchen|burger|sushi|bakery)\b/i],
  ["Groceries", /\b(tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|co-op|coop|iceland|m&s food|grocer|supermarket)\b/i],
  ["Software & Subscriptions", /\b(github|aws|amazon web services|google cloud|microsoft 365|office 365|adobe|jetbrains|slack|notion|figma|dropbox|zoom|openai|anthropic|subscription|saas|licen[cs]e)\b/i],
  ["Telephone & Internet", /\b(vodafone|ee|o2|three|giffgaff|bt|virgin media|sky|broadband|mobile|sim)\b/i],
  ["Office Supplies", /\b(stationery|staples|ryman|viking|paper|toner|ink|envelopes|office)\b/i],
  ["Equipment", /\b(apple store|currys|argos|scan\.co|laptop|monitor|keyboard|printer|hardware|screwfix|b&q|toolstation)\b/i],
  ["Professional Services", /\b(accountant|solicitor|legal|consult|audit|hmrc|companies house)\b/i],
  ["Training", /\b(course|training|udemy|coursera|pluralsight|conference|workshop|ticket)\b/i],
  ["Utilities", /\b(electric|gas|water|octopus|edf|eon|british gas|utility)\b/i],
  ["Insurance", /\b(insurance|assurance|policy|premium)\b/i],
  ["Marketing", /\b(ads|advertising|google ads|meta|facebook|linkedin|printing|flyers|vistaprint)\b/i],
  ["Entertainment", /\b(cinema|odeon|vue|theatre|netflix|spotify|concert|gig)\b/i],
];

/**
 * Keyword categoriser. Used as a fallback when an extractor (e.g. Textract)
 * gives no category, or when the LLM's suggested category isn't in the
 * user's list. Only returns categories present in `allowed`.
 */
export function categoriseByKeywords(text: string | null | undefined, allowed: readonly string[] = DEFAULT_CATEGORIES): string | null {
  if (!text) return null;
  for (const [category, pattern] of KEYWORDS) {
    if (allowed.includes(category) && pattern.test(text)) return category;
  }
  return null;
}

/** Case/whitespace-insensitive match of a suggested value to the user's list. */
export function matchToList(value: string | null | undefined, allowed: readonly string[]): string | null {
  if (!value) return null;
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(value);
  if (!target) return null;
  for (const a of allowed) {
    if (norm(a) === target) return a;
  }
  // loose contains match (e.g. "meals & drinks" -> "Meals")
  for (const a of allowed) {
    const na = norm(a);
    if (na && (target.includes(na) || na.includes(target))) return a;
  }
  return null;
}
