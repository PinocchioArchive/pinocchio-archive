// Given a source URL, infer the source_type and source_name based on the
// domain. Used to auto-populate fields in the edit form when the user
// pastes a URL. Returned fields are flagged as inferred so the UI can
// show a "best guess" badge and let the user confirm.

import type { ImageSourceType } from '../types/schema';

export interface InferredSource {
  source_type: ImageSourceType;
  source_name: string;
  // If true, the inference matched a specific known domain; if false,
  // the inference is a generic fallback (just the hostname) and the user
  // really should review before saving.
  confident: boolean;
}

// Allowlist of domains we recognize with high confidence. Any domain not
// in this table gets a generic "other" inference with a `confident: false`
// flag so the UI can nag the user to verify.
//
// Keep this list focused: auction houses, major institutional archives,
// well-known reference sites. Adding wildly personal/obscure domains
// dilutes the "confident" signal.
interface DomainRule {
  match: string | RegExp;
  source_type: ImageSourceType;
  source_name: string;
}

const DOMAIN_RULES: DomainRule[] = [
  // Auction houses
  { match: 'heritageauctions.com', source_type: 'auction_listing', source_name: 'Heritage Auctions' },
  { match: 'ha.com', source_type: 'auction_listing', source_name: 'Heritage Auctions' },
  { match: 'rrauction.com', source_type: 'auction_listing', source_name: 'RR Auction' },
  { match: 'vaneatongalleries.com', source_type: 'auction_listing', source_name: 'Van Eaton Galleries' },
  { match: 'howardlowery.com', source_type: 'auction_listing', source_name: 'Howard Lowery Auction' },
  { match: 'profilesinhistory.com', source_type: 'auction_listing', source_name: 'Profiles in History' },
  { match: 'sothebys.com', source_type: 'auction_listing', source_name: "Sotheby's" },
  { match: 'christies.com', source_type: 'auction_listing', source_name: "Christie's" },
  { match: 'bonhams.com', source_type: 'auction_listing', source_name: 'Bonhams' },
  { match: 'invaluable.com', source_type: 'auction_listing', source_name: 'Invaluable (aggregator)' },
  { match: 'liveauctioneers.com', source_type: 'auction_listing', source_name: 'LiveAuctioneers (aggregator)' },
  { match: 'lot-art.com', source_type: 'auction_listing', source_name: 'Lot-Art (aggregator)' },
  { match: /\buntitledartgallery\.com/, source_type: 'auction_listing', source_name: 'Untitled Art Gallery' },

  // Archives / institutional
  { match: 'archive.org', source_type: 'archive_website', source_name: 'Internet Archive' },
  { match: 'web.archive.org', source_type: 'archive_website', source_name: 'Wayback Machine' },
  { match: 'archive.is', source_type: 'archive_website', source_name: 'archive.is' },
  { match: 'archive.today', source_type: 'archive_website', source_name: 'archive.today' },
  { match: 'archive.ph', source_type: 'archive_website', source_name: 'archive.ph' },
  { match: 'loc.gov', source_type: 'archive_website', source_name: 'Library of Congress' },
  { match: 'oscars.org', source_type: 'archive_website', source_name: 'Margaret Herrick Library / AMPAS' },
  { match: 'd23.com', source_type: 'disney_archives', source_name: 'D23 / Walt Disney Archives' },
  { match: 'thewaltdisneyfamilymuseum.org', source_type: 'disney_archives', source_name: 'Walt Disney Family Museum' },

  // Fan / blog sites commonly referenced in animation scholarship
  { match: 'disney.fandom.com', source_type: 'fan_site', source_name: 'Disney Wiki (Fandom)' },
  { match: 'cartoonresearch.com', source_type: 'fan_site', source_name: 'Cartoon Research' },
  { match: 'jimhillmedia.com', source_type: 'fan_site', source_name: 'Jim Hill Media' },
  { match: /\bgreganimationart\.blogspot/, source_type: 'fan_site', source_name: 'Greg Animation Art (blog)' },
  { match: /\bcowancollection\w*\.blogspot/, source_type: 'fan_site', source_name: 'Cowan Collection (blog)' },

  // Social media
  { match: 'instagram.com', source_type: 'social_media', source_name: 'Instagram' },
  { match: 'twitter.com', source_type: 'social_media', source_name: 'Twitter / X' },
  { match: 'x.com', source_type: 'social_media', source_name: 'Twitter / X' },
  { match: 'facebook.com', source_type: 'social_media', source_name: 'Facebook' },
  { match: 'pinterest.com', source_type: 'social_media', source_name: 'Pinterest' },
  { match: 'reddit.com', source_type: 'social_media', source_name: 'Reddit' },
  { match: 'tumblr.com', source_type: 'social_media', source_name: 'Tumblr' },

  // Marketplaces
  { match: 'ebay.com', source_type: 'other', source_name: 'eBay' },
  { match: 'etsy.com', source_type: 'other', source_name: 'Etsy' },

  // Reference
  { match: 'wikipedia.org', source_type: 'other', source_name: 'Wikipedia' },
  { match: 'imdb.com', source_type: 'other', source_name: 'IMDb' },
  { match: 'afi.com', source_type: 'archive_website', source_name: 'AFI Catalog' },
  { match: 'catalog.afi.com', source_type: 'archive_website', source_name: 'AFI Catalog' },
];

// Returns a best-guess source inference. Always returns *something* — even
// for unknown domains — but marks `confident: false` for fallback matches
// so the UI can badge them for review.
export function inferSource(rawUrl: string): InferredSource | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  let hostname: string;
  try {
    // Tolerate missing protocol by prepending https:// for parse.
    const url = new URL(
      rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`
    );
    hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const rule of DOMAIN_RULES) {
    if (typeof rule.match === 'string') {
      if (hostname === rule.match || hostname.endsWith('.' + rule.match)) {
        return {
          source_type: rule.source_type,
          source_name: rule.source_name,
          confident: true,
        };
      }
    } else if (rule.match.test(hostname)) {
      return {
        source_type: rule.source_type,
        source_name: rule.source_name,
        confident: true,
      };
    }
  }
  // Fallback: the hostname itself becomes the source name. Not confident.
  return {
    source_type: 'other',
    source_name: hostname,
    confident: false,
  };
}

// Normalizes a URL for display and for Wayback submission.
// Strips fragment, some tracking params, preserves path + meaningful query.
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(
      rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`
    );
    url.hash = '';
    // Strip common tracking params
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'mc_cid', 'mc_eid',
    ];
    for (const p of trackingParams) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
