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

export interface ImageSource {
  url?: string;
  source_type: ImageSourceType;
  source_name?: string;
  retrieved?: string;
  watermark?: string;
  notes?: string;
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

export interface ModelSheet {
  id: string;
  sheet_number_prefix: string;
  sheet_number_numeric: number;
  sheet_number_suffix: string;

  title: string;
  characters: string[];
  // Which narrative sequence the characters on this sheet are associated with.
  // This is usually a research inference (e.g., "Girls of All Nations"), not
  // something stamped on the sheet itself. Character Model Department sheets
  // typically predate per-scene production numbering.
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

  image_file: string;
  image_width?: number;
  image_height?: number;
  image_sources: ImageSource[];

  published_references: PublishedReference[];
  web_occurrences: WebOccurrenceReading[];
  rarity: {
    market: RarityLevel;
    institutional: RarityLevel;
    iconographic: RarityLevel;
  };
  confidence: Confidence;
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
  schema_version: 4;
  sheets: ModelSheet[];
}
