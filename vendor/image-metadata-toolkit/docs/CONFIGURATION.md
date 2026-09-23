# Configuration

The configuration is JSON. Start with `examples/metadata-config.example.json`.

## Ownership

- `creator`: human or organization that created the image.
- `publisher`: publishing site or organization.
- `website_url`: absolute HTTP(S) creator URL.
- `rights_notice`: supports `{year}`, `{creator}`, `{publisher}`, and `{website_url}` placeholders.
- `credit`: preferred display credit.
- `marked`: XMP rights-management flag.

All ownership fields are required for `clean` and `verify`.

## Content fields

Lite does not invent semantic metadata. Set `title`, `description`, and `subjects` for a specific run, or leave them blank with `preserve_existing_when_blank` enabled to retain existing XMP values. Automatic filename-based metadata is a Pro feature.

## Privacy cleanup

When enabled, the toolkit clears metadata containers, restores color-space tags and orientation, and writes the configured XMP fields. It then scans for private tags and refuses to pass verification if they remain.

## Rendering preservation

When enabled, width, height, and ExifTool `ImageDataHash` must match before and after. The toolkit does not intentionally re-encode image pixels.

## Provenance

Use `preserve` unless you have a specific, rights-authorized reason to accept credential invalidation. See `PRIVACY-AND-PROVENANCE.md`.
