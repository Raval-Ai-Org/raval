# Security Policy

## Supported version

Security fixes are provided for the latest release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing a working exploit, private image metadata, credentials, or personal data.

## Security model

- Processing is local and does not upload images.
- Source files are read-only; outputs are staged and verified before atomic placement.
- The toolkit never needs API keys or network credentials.
- Signed provenance causes a default fail-closed result.
- Reports can contain metadata from your files; review them before sharing.
