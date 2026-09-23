# Examples

Audit a mixed folder and save JSON:

```bash
image-metadata-toolkit audit ~/Pictures/to-publish --report audit.json
```

Preview a recursive write:

```bash
image-metadata-toolkit clean ~/Pictures/to-publish \
  --config metadata-config.json \
  --output-dir ~/Pictures/cleaned \
  --dry-run
```

Create verified copies, allowing existing destination files to be replaced atomically:

```bash
image-metadata-toolkit clean ~/Pictures/to-publish \
  --config metadata-config.json \
  --output-dir ~/Pictures/cleaned \
  --overwrite \
  --report write-report.csv
```

Verify before publishing:

```bash
image-metadata-toolkit verify ~/Pictures/cleaned \
  --config metadata-config.json \
  --report verify.json
```
