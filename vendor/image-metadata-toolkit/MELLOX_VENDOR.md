# Vendored copy

Source: https://github.com/GitBreak/image-metadata-toolkit
Pinned commit: `3f1af5c0b27999d037ab422570c2f9fd1c156b55` (tag `v1.0.0`, the MIT-licensed
"Lite" edition)
Vendored: unmodified, verbatim source tree (see `LICENSE`).

Mellox invokes this as a CLI subprocess from
[`src/server/assets/image-metadata.server.ts`](../src/server/assets/image-metadata.server.ts) —
it is not reimplemented. Requires Python 3.10+ and the `exiftool` binary on
`PATH` (see that file's header comment for details and for the runtime
requirement declaration).

To update: re-clone the tag, diff against this directory, replace wholesale,
and update the pinned commit above. Do not hand-edit the vendored source —
behavior differences from upstream become invisible and unauditable.
