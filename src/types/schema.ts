// Schema for a single model sheet record.
// Fields are designed to support scholarly provenance research:
// - Sheet numbers are decomposed so sorting works numerically (M19 before M174).
// - Image provenance is tracked separately from the physical sheet's own provenance.
// - Rarity has three dimensions (market/institutional/iconographic) kept separate.
// - Confidence flags let you distinguish verified facts from working hypotheses.
// - needs_research flag enables the "quick capture then come back" workflow.

export type Confidence = 'high' | 'medium' | 'low' | 'unverified';

export type DatePrecision = 'exact' | 'month' | 'year' | 'range' | 'unknown';

export type RarityLevel =
  | 'unique'
  | 'rare'
  | 'uncommon'
  | 'common'
  | 'unknown';

export type ImageSourceType =
  | 'auction_listing'
  | 'published_book'
  | 'archive_website'
  | 'fan_site'
  | 'social_media'
  | 'personal_photograph'
  | 'disney_archives'
  | 'other'
  | 'unknown';

// Status of the Wayback Machine capture for this source's original URL.
// - 'not_attempted': no capture has been tried yet
// - 'pending': capture fired but verification hasn't completed (typical 30-60s window)
// - 'verified': HEAD request confirms the snapshot resolves
// - 'failed': verification returned a non-OK response (often robots.txt blocked)
export type ArchiveStatus =
  | 'not_attempted'
  | 'pending'
  | 'verified'
  | 'failed';

export interface ImageSource {
  url?: string;
  source_type: ImageSourceType;
  source_name?: string;
  retrieved?: string;
  notes?: string;

  // Wayback Machine preservation data. `archive_url` is the expected
  // Wayback URL (a deterministic redirect to the latest-available snapshot
  // of `url`). It's populated optimistically on capture; the `archive_status`
  // field reflects whether verification has actually confirmed the snapshot.
  archive_url?: string;
  archive_captured_at?: string; // ISO timestamp of capture request
  archive_status?: ArchiveStatus;

  // When the URL is pasted and auto-populated via domain inference, these
  // flags mark which fields were auto-filled. UI shows a "best guess" badge
  // and lets the user confirm (clearing the flag) or edit (implicit confirm).
  source_name_inferred?: boolean;
  source_type_inferred?: boolean;

  // Optional auction/sale data. When an image source IS an auction
  // listing (Van Eaton lot page, Heritage archive entry, Worthpoint
  // record, eBay listing, etc.), these fields capture the sale
  // event's factual data: lot identifier, sale date, hammer price.
  // All fields are optional — most image sources (e.g., a magazine
  // scan on Flickr) won't have any of them. For sources that do,
  // the data gets displayed as a small provenance table next to
  // the source link.
  //
  // Legal note on recording these: sale prices, dates, and lot
  // numbers are facts and not subject to copyright under Feist v.
  // Rural Telephone. Recording "sold for $X on date Y, lot Z at
  // house W" — with attribution back to where we observed the data
  // (e.g., Worthpoint) — is standard scholarly provenance practice.
  // We don't store or republish auction-house descriptive text or
  // photos (those ARE copyrighted).

  // The auction house or selling platform (Van Eaton Galleries,
  // Heritage Auctions, Sotheby's, eBay, etc.). Often the same as
  // `source_name`, but can differ — e.g., a Worthpoint record of a
  // Van Eaton sale has source_name="Worthpoint" and
  // auction_house="Van Eaton Galleries".
  auction_house?: string;

  // The lot number at auction. Whatever format the auction house
  // uses: "Lot 234", "234A", "8/234", etc. Stored as entered.
  lot_number?: string;

  // A vendor-specific identifier — Worthpoint SKU, eBay item number,
  // Heritage's internal ID. Useful because these outlive the live
  // listing and can be used to find the record again later.
  sku?: string;

  // Sale date. ISO format preferred (YYYY-MM-DD) but partial dates
  // OK ("2018-03", "2018"). `sale_date_precision` carries how
  // specific the date actually is.
  sale_date?: string;
  sale_date_precision?: DatePrecision;

  // Hammer price (the actual sold price, excluding buyer's premium
  // unless explicitly noted in `notes`). Stored as a decimal number
  // — 4200 for $4,200, 185.50 for $185.50. Currency carried
  // separately.
  price_sold?: number;
  currency?: string; // ISO 4217: "USD", "GBP", "EUR", etc.

  // Pre-sale estimate range, if known. Scholarly-relevant because
  // it captures what the auction house thought the item was worth
  // at the time — useful for tracking how valuation has shifted.
  price_estimate_low?: number;
  price_estimate_high?: number;

  // Did it actually sell? false = passed / bought-in (didn't meet
  // reserve). Default undefined = unknown; true = sold; false =
  // did not sell. Distinguishing "unsold" from "unknown" matters
  // because an unsold auction is a different data point than an
  // undocumented one.
  sold?: boolean;
}

export interface PublishedReference {
  source: string;
  page?: number | string;
  notes?: string;
}

// A timestamped web-occurrence-count reading. You check Google Lens or TinEye,
// record how many hits you found and when. Multiple readings over time let you
// see if a sheet is getting more widely reproduced.
export interface WebOccurrenceReading {
  count: number;
  checked_on: string; // ISO date
  source: 'google_lens' | 'tineye' | 'google_images' | 'other';
  notes?: string;
}

// A production stamp visible on the artifact itself, per Disney's internal
// numbering convention: PROD [feature number] SEQ [n.n] SCENE [n].
// Example: "PROD 2003 SEQ 4.2 SCENE 50" on a Stromboli production drawing.
// These are primary-source documentary evidence, unlike sequence_association
// which is usually a research inference.
export interface ProductionStamp {
  prod_number?: string; // e.g., "2003" (F-3/Pinocchio); "F-3" is the older variant
  sequence_number?: string; // e.g., "4.2" or "4-2"
  scene_number?: string; // e.g., "50"
  location_on_sheet?: string; // "lower right", "verso top", etc.
  notes?: string;
}

// A handwritten or stamped mark on a sheet whose meaning is not yet
// known. Often numerical (e.g., "19-347" penciled in a corner) but
// can also be letters or mixed. The researcher logs these as they
// find them, and can later sort / filter by mark value to discover
// sheets that share codes — the kind of pattern-spotting that leads
// to figuring out what the codes actually mean.
export interface SheetMark {
  value: string; // the mark itself as transcribed
  notes?: string; // optional context: where it appears, medium, theories
}

export interface ModelSheet {
  id: string;
  sheet_number_prefix: string;
  sheet_number_numeric: number;
  sheet_number_suffix: string;

  title: string;
  characters: string[];
  // The numbered narrative sequence this sheet's characters belong to,
  // e.g., "1.5" or "4.2". Usually inferred, not stamped, on Character
  // Model Department sheets — they predate per-scene production numbering.
  sequence_association?: string;
  // Confidence in the sequence_association — since this is usually inferred.
  sequence_association_confidence?: Confidence;
  // Production stamps literally visible on the object (drawings & cels, rarely
  // on M-sheets). Stamps look like "PROD 2003 SEQ 4.2 SCENE 50".
  production_stamps: ProductionStamp[];
  department?: string;
  artist?: string;

  date_on_sheet?: string;
  date_precision: DatePrecision;

  approvals: string[];

  // Unidentified handwritten or stamped marks on the sheet — numerical
  // codes, letter codes, inspection marks, catalog numbers of uncertain
  // origin, etc. These are distinct from `production_stamps` (where we
  // know what each part means): sheet marks are "I see this marking, I
  // don't yet know what it signifies." Logging them lets the researcher
  // find sheets that share the same mark and investigate common origin.
  sheet_marks?: SheetMark[];

  image_file: string;
  image_width?: number;
  image_height?: number;
  image_sources: ImageSource[];

  // Perceptual hash of `image_file` — a 64-bit dHash encoded as 16 hex
  // chars. Used for fast in-browser image similarity search. Null/absent
  // means "not yet computed"; the background indexer fills these in
  // lazily as sheets are loaded and commits them back to sheets.json.
  //
  // Hash comparability: two hashes are only meaningfully comparable if
  // both were computed by the same algorithm. This one is dHash at 8×9
  // (horizontal-gradient) → 64-bit. Changing the algorithm later would
  // require re-hashing all sheets; the algorithm version is implicit
  // in this field's name (future versions would add image_hash_v2).
  image_hash?: string;

  // Optional CLIP-style neural embedding for deeper image matching
  // (semantic similarity, finding stylized derivations such as merch
  // adapted from a sheet). Typically 512 floats, stored as a base64-
  // encoded Float32Array to keep JSON compact. Computed on-demand
  // when the user runs a "Deep match" search, then cached.
  image_embedding?: string;

  published_references: PublishedReference[];
  web_occurrences: WebOccurrenceReading[];
  rarity: {
    market: RarityLevel;
    institutional: RarityLevel;
    iconographic: RarityLevel;
  };
  needs_research: boolean;
  tags: string[];
  notes: string;

  // Audit trail of every extraction run, whether accepted or not.
  // Lets scholars see what automated tools proposed vs. what was kept.
  extractions?: ExtractionAudit[];

  created_at: string;
  updated_at: string;
}

// A record of one extraction run — what extractor, what it saw, what fields
// from it were accepted into the record.
export interface ExtractionAudit {
  extracted_by: 'tesseract' | 'claude';
  extracted_at: string;
  result: unknown; // the raw ExtractionResult; kept opaque at this layer
  accepted_fields?: string[]; // field names the user accepted
}

export interface ArchiveData {
  schema_version: 5;
  sheets: ModelSheet[];
}
