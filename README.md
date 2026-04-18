# Pinocchio Model Sheet Archive

A scholarly finding aid for Disney *Pinocchio* (1940) Character Model Department sheets, built as a static React site hosted on GitHub Pages with metadata stored as JSON in the repo itself.

## What it does

Browse, search, filter, edit, and add model sheet records. Track scholarly provenance — where you got each image, who published it, what watermarks or auction stamps are visible, how often it turns up in reverse-image searches over time.

## Workflow for bulk entry

The tool is designed around the realistic workflow of processing hundreds of sheets you've collected from around the web:

1. **Bulk import**: click `⬒ Bulk`, drop 20–50 image files onto the drop zone. Sheet numbers are auto-guessed from filenames. Each image becomes a stub record flagged *Needs Research*.
2. **Process the queue**: click `Needs research (N)` chip, then click any card. The edit form opens with full metadata fields.
3. **Save & Next**: fill in what you know. Press `Cmd/Ctrl+Enter` (or click the red "Save & Next →" button) to save and jump to the next record in the research queue. The queue goes most-recently-added first.
4. **Run out**: you get a "all caught up" toast when the research queue empties.

For records with partial information, flip `Needs Research` to `Yes` and save — the record goes back on the queue for later.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `n` | New sheet |
| `b` | Bulk import |
| `/` | Focus search |
| `j` / `k` | Move focus between cards |
| `↵` | Open focused card |
| `e` | Edit currently-open record |
| `esc` | Close modal |
| `⌘S` / `Ctrl+S` | Save (in edit form) |
| `⌘↵` / `Ctrl+Enter` | Save & Next (in edit form) |

## Features

### Entry speed
- Autocomplete on character, sequence, department, artist, tag, approval, and image-source-name fields — vocabulary builds itself from your prior entries.
- Tag inputs: Enter adds, Backspace removes, ↓ browses suggestions.
- Drag-drop or paste-from-clipboard on the edit form's image field.
- Duplicate sheet ID detection with a clear warning.
- Recent values (sequence, department, last source) pre-filled on new records.
- Filename-based sheet number guessing for bulk imports.

### Finding things
- URL-persistent filters — bookmarkable views like "all sheets for sequence 4.2" or "everything in my research list for chapter 3."
- Facet chips with counts: "Sequence 4.2 (3)".
- Search across ID, title, characters, sequence, notes, tags, approvals. "m174" matches "M174-A".
- Five sort modes: sheet number (numeric-correct), date on sheet, title, recently updated, recently added.
- Grid view or list view (density toggle).
- "Needs Research" as a first-class filter and badge on cards.

### Reverse-image search & "web occurrences"
- Every card with a committed image gets one-click Google Lens and TinEye reverse-image-search buttons.
- You record what you find — a timestamped count and source — in the `web_occurrences` field. A single record can hold a history of readings over time.
- Lets you empirically track how often a sheet is reproduced online, and whether that's trending up or down.
- The `latest_web_count` is exported in the CSV, sortable in the UI, and can serve as a proxy for iconographic rarity.
- Note: this is manual-entry by design. There is no legitimate free API for automated Google reverse-image-count. See "Why no automation?" below.

### Automated field extraction (OCR + AI)

Two extractors, same interface:

**Tesseract (free, on-device).** Runs in your browser when you bulk-import images or click the ⚙ OCR button on a record. Extracts sheet number, date, department, known approvers (Joe Grant, Albert Hurter, etc.), and best-guess title. Realistic accuracy is 60-80% on clean printed text, much worse on handwriting. Automatically skips low-resolution (under 600px wide) images where OCR would produce garbage. The tesseract.js library (~4MB WASM + 2MB English data) loads from a CDN the first time you use it.

**Claude (paid, higher accuracy).** Vision-language model reads the image and returns structured JSON. Accuracy is typically 85-95% on printed fields, usefully reads handwritten annotations too. Cost is ~$0.01-0.03 per image (so ~$10 for 400 sheets). Requires an Anthropic API key configured in Settings.

**Review workflow.** Extraction never overwrites your data silently. It opens a side-by-side review modal showing current value vs. proposed value, per field, with confidence indicators (high/medium/low). You accept, edit, or reject each field individually. When OCR runs during bulk import, only the sheet number (if high confidence) is auto-used for the record ID; everything else is saved as an extraction audit entry for you to review later in the edit form.

**Audit trail.** Every extraction run is persisted in the record's `extractions` history — what extractor was used, when, what it saw, and which fields you accepted. This is essential scholarly provenance: six months from now you can see whether "M174-A" in a record was typed by you, extracted by Tesseract with high confidence, or suggested by Claude and accepted.

**Cross-check.** When a filename suggests one sheet number ("M174-A dutch girl.jpg") and OCR reads a different one, the review modal flags the disagreement in red so you notice before accepting.

### Scholarly data model
- Decomposed sheet numbers for correct numeric sorting (M19 before M174 before M231).
- Image provenance separated from sheet provenance: each `image_source` tracks URL, source type, source name, date retrieved, watermarks/stamps, notes.
- Three-dimensional rarity (market / institutional / iconographic), kept separate rather than collapsed.
- Confidence flag (high / medium / low / unverified) per record.
- Published-references block with source, page, notes.
- Image dimensions auto-captured on upload; card shows "low-res" badge for anything under 800px on the long edge.
- Audit timestamps (`created_at`, `updated_at`).
- **Sequence association** (research inference) separated from **production stamps** (primary-source markings). See "Sequence terminology" below.

### Sequence terminology

A Disney "sequence" is a numbered subdivision of the film; *Pinocchio* was split into roughly a dozen sequences during production, each assigned to a sequence director. Original production drawings and cels typically carry a stamp like "PROD 2003 SEQ 4.2 SCENE 50" — primary-source documentary evidence of where in the film an artifact belongs.

Character Model Department sheets (the M-numbered ones) are a different beast. They're design references produced by a department under Joe Grant, and they usually predate per-scene production numbering. An M-sheet doesn't get a SEQ stamp; it depicts characters that *appear in* a given sequence, and that association is usually a research inference rather than a printed fact.

The schema splits these cleanly:

- **`sequence_association`** — the numbered narrative sequence this sheet's characters belong to, e.g., "1.5" or "4.2". Usually inferred, not stamped. Carries a separate **`sequence_association_confidence`** field (high/medium/low/unverified) so you can distinguish primary-source confirmation from a working hypothesis.
- **`production_stamps`** — a structured array of stamps literally visible on the object. Each stamp has `prod_number` (usually "2003" for Pinocchio), `sequence_number` (e.g. "4.2"), `scene_number`, `location_on_sheet`, and free-text notes. This is where primary-source data goes.

For your Character Model Department sheets (M19-A, M174-A, M231-A, etc.), you'll mostly use `sequence_association` with a confidence flag. For the Ubangi cel with drawings (M36-A) and any other drawings/cels you hold, check for actual stamps and record them in `production_stamps`.

### Character sort and group-by-character view

**Sort: Character** sorts sheets alphabetically by their first (alphabetized) character, with tiebreakers on second character, etc. Empty character lists sort last.

**View: Group by Character** renders a separate section for each character, with the sheets that include that character listed under it. A sheet with multiple characters appears in each of its characters' groups. The masthead shows "N appearances across M characters" in that view so the double-counting is honest.

### Save & sync
- Writes commit directly to the GitHub repo via a fine-grained PAT.
- Fallback: without a token, the tool downloads the updated `sheets.json` for you to commit manually.
- Every save is a real git commit with a real commit message, so you have full audit history.

## Architecture

- **Frontend**: React + TypeScript, built with Vite.
- **Hosting**: GitHub Pages, deployed via GitHub Actions on every push to `main`.
- **Data**: `data/sheets.json` at the repo root — a single JSON file, source of truth.
- **Images**: `images/*.jpg` etc. at the repo root.
- **Writes**: fine-grained PAT in localStorage → GitHub Contents API.

## First-time setup

### 1. Create the repository

Create a new repo on GitHub named `pinocchio-archive`. Public repos get free Pages hosting; private repos need GitHub Pro.

### 2. Push this code

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pinocchio-archive.git
git push -u origin main
```

### 3. Enable GitHub Pages

In the repo: **Settings → Pages** → **Source: GitHub Actions** → Save.

The first push already triggered the workflow. The **Actions** tab shows it running. The site will be live at:

```
https://YOUR_USERNAME.github.io/pinocchio-archive/
```

### 4. Create a fine-grained PAT

1. [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
2. **Generate new token** → **Fine-grained token**
3. **Name**: `pinocchio-archive-edits`
4. **Expiration**: 1 year is reasonable
5. **Resource owner**: your account
6. **Repository access**: **Only select repositories** → pick `pinocchio-archive`
7. **Permissions → Repository permissions**:
   - **Contents**: **Read and write**
   - **Metadata**: Read-only (auto-selected)
8. Generate, copy the token immediately (you won't see it again)

### 5. Configure the app

Open your deployed site → **Settings** → fill in owner, repo, branch, token → **Save & Verify**.

Green "Connected as YOUR_USERNAME" pill means you're set.

### 6. (Optional) Add an Anthropic API key for AI extraction

Tesseract OCR works without any key and will extract sheet numbers and dates from clean printed stamps. To also enable the more accurate Claude extraction (paid):

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
2. **Important**: go to **Plans & Billing → Usage Limits** and set a monthly spending limit. Extraction costs ~$0.01-0.03 per image, so $20/month is plenty of headroom for 500-2000 image reviews.
3. Copy the key (starts with `sk-ant-api03-`)
4. In the app, **Settings** → paste into **Anthropic API Key** → **Save & Verify**

Now the ✨ AI Extract button is enabled on every record. The ⚙ OCR button remains available regardless.

## Why no automation for reverse-image-search counts?

There's no legitimate, free, stable API that returns "number of copies of this image on the public web." Options considered:

- **Google Custom Search JSON API**: searches text, not images. Free tier but doesn't do what's needed.
- **Google Lens / Images**: no public API. Services that claim to offer it are scraping, which violates ToS and gets IP-blocked.
- **TinEye API**: legitimate but paid (around $200/month base), needs a server-side proxy for the key. Doable later as a paid upgrade.
- **Manual entry with one-click search buttons**: what this tool does. You click Lens, eyeball the count, record it with a date. It respects scholarly methodology (you're making the judgment), works from a static site, and is free.

If you later want automation, the architecture supports it — add a small backend proxy for TinEye and have the app call it.

## Schema versions

The tool reads v1 files (from before `needs_research` and `web_occurrences` existed) and auto-migrates them to v2 on load. New records save as v2. No manual migration needed.

## Extending the schema

Add a field in `src/types/schema.ts`, a form field in `src/components/SheetEdit.tsx`, a display row in `src/components/SheetDetail.tsx`. Existing records will have it `undefined` until edited. JSON handles this naturally.

## Developing locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173/pinocchio-archive/`.

## Controlled vocabulary notes

Autocomplete builds vocabulary as you go, but it's still worth settling canonical forms early. Recommended:

- Sequence associations: use the numbered form, e.g., "1.5" or "4.2". If a sheet has an actual stamped sequence number, put that in `production_stamps.sequence_number` separately.
- Sources: pick one of "Van Eaton Galleries" or "Van Eaton", not both
- Departments: "Character Model Department" (already the default)
- Tags: snake_case (e.g. `deleted_sequence`, `post_restructure`)

The autocomplete shows counts — if you see "Van Eaton (3)" and "Van Eaton Galleries (1)", edit the odd one out.

## License

Private scholarly research tool. Images and data belong to you and to the respective rights holders of the original Disney production material.
