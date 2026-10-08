# Image upload pipeline (core)

Date: 2026-10-08
Refs: TAT-21

## Goal

Every image a user uploads goes through one service that checks it is a real image, re-encodes it without metadata and stores it on the right disk: public or private. Studio QR codes (TAT-26) are the first user. Artist photos (TAT-31), reference images (TAT-51) and payment proofs (TAT-65) build on it.

This is the lean core of TAT-21. Resized variants made in the worker and HEIC decoding come later, when an image needs them. The R2 and CDN setup is TAT-27.

## Decisions

- **Storage:** `@adonisjs/drive` (flydrive). In dev and tests both disks are local folders. Production switches them to R2 in config (TAT-27), with no code changes.
- **References:** the owning record keeps the image key in a column, e.g. `payment_methods.qr_image_key`. There is no shared images table. Width and height are stored only where a page needs them.
- **Processing** happens in the request with sharp. No worker this round.

## Module and disks

The new `media` module lives in `app/modules/media/` and is imported as `#modules/media/*`.

`config/drive.ts` has two disks:

| Disk | Dev and tests | Served at | Production (TAT-27) |
|---|---|---|---|
| `public` | `storage/public/` | `/uploads/<key>` | R2 bucket behind the CDN |
| `private` | `storage/private/` | `/files/<key>`, signed URLs only | private R2 bucket |

- `storage/` is gitignored. Tests use a temporary folder that is emptied after the run.
- Drive's file server answers 401 for a private file unless the URL carries a valid, unexpired signature.

## Purposes

A purpose decides the disk, so a caller can't store a private image publicly by mistake:

```ts
const IMAGE_PURPOSES = {
  payment_qr: { visibility: "public" }, // TAT-26
  payment_proof: { visibility: "private" }, // TAT-65; defined now so the private path is tested
} as const;
```

Each later ticket adds its own purpose (`artist_photo`, `reference`, …).

## ImageService

```ts
store(file: MultipartFile, { tenant, purpose }): Promise<{ key: string; width: number; height: number }>
url(purpose, key): Promise<string>
delete(purpose, key): Promise<void>
```

- `url` returns the public URL, or a signed URL valid for 5 minutes for a private purpose.
- `delete` is best effort: a missing file is not an error, and any other failure is logged rather than thrown.
- Callers load the owning record scoped to `ctx.tenant` before they ask for a URL. That load is the membership check for private images.

## Validation and processing

The `imageFile()` VineJS rule is shared by every upload form: 10 MB, extensions jpg, jpeg, png and webp. It is only a first filter. The real check happens in `store()`:

1. **Decode.** sharp reads the bytes and reports the actual format. Only JPEG, PNG and WebP pass. A renamed text file, a GIF, a PDF or a HEIC file throws `InvalidImageError`. The controller shows it as a field error ("Upload a JPEG, PNG or WebP image"), the way `SlugTakenError` works.
2. **Pixel limit.** `limitInputPixels: 40_000_000` rejects an image above 40 MP before it is decoded, which stops decompression bombs.
3. **Re-encode:**
   - `.rotate()` applies the EXIF orientation first.
   - The image is resized to fit 2048 × 2048, never enlarged.
   - PNG stays PNG (lossless, so QR codes stay scannable). JPEG and WebP become JPEG at quality 85, with transparency flattened onto white.
   - No metadata is written: EXIF, GPS, camera data and embedded thumbnails are dropped.
4. **HEIC** is rejected with a clear message. sharp's prebuilt binaries can't decode HEVC, and browsers on iPhones usually upload JPEG. TAT-51 adds a decoder if references need it.

Payment apps' "scan from gallery" reads PNG and JPEG reliably, but not always WebP. That is why the output is never WebP.

## Keys, writes and failures

- **Key:** `tenants/<tenantId>/<purpose>/<random-uuid>.<png|jpg>`.
  - The UUID is a random v4, never v7 and never the uploaded filename, so public URLs can't be guessed or enumerated.
  - The tenant prefix lets later cleanup (TAT-42, tenant deletion) find a tenant's files.
- **Order:** `store()` writes the file, then the caller saves its row. If that save fails, the caller calls `delete()` in a `catch`.
- **Replacing an image** deletes the old file only after the transaction commits. A rollback never loses the file the row still points to.
- **Soft-deleted owners keep their files**, so `restore()` works. Removing them for good is later work (TAT-42 / V1).

## Tests

Images are generated with sharp inside the tests, so no binary fixtures are committed.

- **Processing:**
  - PNG in → PNG out.
  - JPEG with EXIF and GPS in → no EXIF out.
  - A photo with EXIF orientation 6 comes out upright: width and height swapped.
  - A 4000 px image comes out at 2048 px.
  - Transparency in a WebP becomes white in the JPEG.
- **Rejections:** a text file named `.png`, a GIF, a HEIC file, an image over 40 MP.
- **Keys:**
  - Keys carry the tenant and purpose prefix and the right extension.
  - Storing the same file twice gives two different keys.
- **Disks:** `payment_qr` lands on the public disk. `payment_proof` lands on the private disk, never on the public one.
- **Serving, over HTTP:**
  - A public file returns 200.
  - A private file without a signature returns 401.
  - A private file with a valid signature returns 200.
  - A private file with a tampered or expired signature returns 401.
- **Delete:** removes the file, and doesn't throw when the file is already gone.

## Out of scope

- Resized variants made in the worker.
- HEIC decoding.
- The R2/S3 disk config and the CDN (TAT-27).
- Upload UI: the first form is TAT-26's payment settings.

## Docs and Linear

- `apps/platform/AGENTS.md`:
  - Every upload goes through `ImageService` and `imageFile()`.
  - Purposes decide visibility.
  - Owners keep the key.
  - Delete after commit; delete on a failed save.
- `docs/architecture.md`: note that HEIC and worker variants are deferred.
- Linear:
  - TAT-21: tick what this round delivers and move the rest (variants, HEIC) to a follow-up checklist.
  - Add TAT-21 as blocking TAT-26 and TAT-31.
