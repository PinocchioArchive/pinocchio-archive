// Format a numeric price with currency symbol.
// Uses Intl.NumberFormat where possible for proper locale-aware
// formatting (commas/periods, symbol placement). Falls back to a
// plain numeric string if the currency code is unknown or the
// browser doesn't support the format.
//
// Examples:
//   formatPrice(4200, 'USD') → "$4,200"
//   formatPrice(185.5, 'USD') → "$185.50"
//   formatPrice(120, 'GBP') → "£120"
//   formatPrice(undefined, 'USD') → ""

export function formatPrice(
  amount?: number,
  currency: string = 'USD'
): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '';
  }
  try {
    // Round trip-safe: show decimals only if the amount has them.
    // Integer prices don't need ".00" cluttering the display.
    const hasDecimals = amount % 1 !== 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown currency code, bad input, etc. Fall back to a plain
    // number with the code trailing.
    return `${amount} ${currency || ''}`.trim();
  }
}

// Format an estimate range into "low–high" notation. Returns empty
// string if neither bound is set.
export function formatEstimateRange(
  low?: number,
  high?: number,
  currency: string = 'USD'
): string {
  if (low === undefined && high === undefined) return '';
  if (low !== undefined && high !== undefined) {
    // Use en-dash rather than hyphen — it's the typographic
    // convention for numeric ranges.
    return `${formatPrice(low, currency)}–${formatPrice(high, currency)}`;
  }
  if (low !== undefined) return `${formatPrice(low, currency)}+`;
  return `up to ${formatPrice(high, currency)}`;
}

// List of commonly-used currency codes for the dropdown. ISO 4217.
// USD is the default because most of the archive's sale activity is
// in US auction houses; can be expanded if European sales become
// common.
export const COMMON_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
];
