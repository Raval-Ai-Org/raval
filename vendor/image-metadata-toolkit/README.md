# Image Metadata Toolkit

Clean private metadata. Add ownership and attribution. Verify images before you publish.

Image Metadata Toolkit Lite is a local, ExifTool-powered command-line workflow for WebP, JPEG/JPG, and PNG files. It audits privacy-sensitive fields, writes configurable XMP ownership metadata to new copies, and verifies that image dimensions and compressed pixel data did not change.

This is not an SEO ranking hack, a SynthID remover, a Content Credentials bypass, or a tool for evading AI labels.

## Features

- inspect/audit one file, several files, or recursive folders;
- report GPS, camera/device, serial, owner, software, and private-comment fields;
- clean metadata while preserving color-profile and orientation information;
- configure Creator, Publisher, Creator URL, Rights, Credit, and Marked;
- preserve existing Title, Description, and Subject values when desired;
- dry-run before writing;
- verify ownership and privacy policy after writing;
- JSON or CSV reports;
- source files are never modified;
- default fail-closed handling for C2PA/Content Credentials.

## Requirements

- Python 3.10+
- [ExifTool](https://exiftool.org/) 12.70 or newer recommended

On macOS with Homebrew:

```bash
brew install exiftool
```

On Debian/Ubuntu:

```bash
sudo apt-get install libimage-exiftool-perl
```

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install .
cp examples/metadata-config.example.json metadata-config.json
```

Edit `metadata-config.json`, then audit and dry-run:

```bash
image-metadata-toolkit audit ./images --report audit.json
image-metadata-toolkit clean ./images \
  --config metadata-config.json \
  --output-dir ./cleaned \
  --dry-run \
  --report dry-run.csv
```

Write new copies and verify them:

```bash
image-metadata-toolkit clean ./images \
  --config metadata-config.json \
  --output-dir ./cleaned \
  --report write-report.json

image-metadata-toolkit verify ./cleaned \
  --config metadata-config.json \
  --report verification.csv
```

Existing outputs are not replaced unless `--overwrite` is supplied. Even with that flag, replacement is atomic and only occurs after staging and verification pass.

## Provenance policy

The default `"provenance_policy": "preserve"` audits for C2PA, JUMBF, and Content Credentials. If detected, the toolkit refuses to modify the file because changing metadata can invalidate a signed credential.

`"allow-metadata-change"` is an explicit opt-in for a rights holder who understands that metadata edits may invalidate or remove a credential container. It does not target SynthID or any invisible watermark. See [Privacy and provenance](docs/PRIVACY-AND-PROVENANCE.md).

## Editions

This repository contains the MIT-licensed Lite edition. The free Starter pack adds Finder Quick Actions and installers. Pro adds WordPress propagation, a fail-closed historical retrofit, automatic filename metadata, overrides, rollback, cache QA, and production checklists.

## License and security

MIT licensed. See [LICENSE](LICENSE), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
