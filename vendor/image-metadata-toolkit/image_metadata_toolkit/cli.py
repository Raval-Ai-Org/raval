from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ConfigError, load_config
from .core import ToolkitError, clean_file, discover, inspect_file, verify_file, write_report
from .exiftool import ExifToolError


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="image-metadata-toolkit",
        description="Audit, clean, attribute, and verify WebP, JPEG, and PNG metadata.",
    )
    root.add_argument("--version", action="version", version="%(prog)s 1.0.0")
    commands = root.add_subparsers(dest="command", required=True)

    for name in ("inspect", "audit"):
        command = commands.add_parser(name, help="Inspect metadata and report privacy/provenance findings.")
        command.add_argument("paths", nargs="+", help="Image files and/or folders")
        command.add_argument("--report", type=Path, help="Write a JSON or CSV report")

    clean = commands.add_parser("clean", help="Create cleaned, attributed copies without editing sources.")
    clean.add_argument("paths", nargs="+", help="Image files and/or folders")
    clean.add_argument("--config", required=True, type=Path, help="JSON configuration file")
    clean.add_argument("--output-dir", type=Path, help="Destination directory")
    clean.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    clean.add_argument("--overwrite", action="store_true", help="Atomically replace existing outputs")
    clean.add_argument("--report", type=Path, help="Write a JSON or CSV report")

    verify = commands.add_parser("verify", help="Verify ownership and privacy policy.")
    verify.add_argument("paths", nargs="+", help="Image files and/or folders")
    verify.add_argument("--config", required=True, type=Path, help="JSON configuration file")
    verify.add_argument("--report", type=Path, help="Write a JSON or CSV report")
    return root


def _output_path(source: Path, inputs: list[str], output_dir: Path) -> Path:
    for raw in inputs:
        root = Path(raw).expanduser().resolve()
        if root.is_dir():
            try:
                return output_dir / source.relative_to(root)
            except ValueError:
                continue
    return output_dir / source.name


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        files = discover(args.paths)
        if args.command in {"inspect", "audit"}:
            findings = [inspect_file(path) for path in files]
        elif args.command == "verify":
            config = load_config(args.config)
            findings = [verify_file(path, config) for path in files]
        else:
            if not args.dry_run and args.output_dir is None:
                raise ToolkitError("--output-dir is required unless --dry-run is used.")
            config = load_config(args.config)
            output_dir = (args.output_dir or Path.cwd() / "cleaned").expanduser().resolve()
            findings = [
                clean_file(
                    path,
                    _output_path(path, args.paths, output_dir),
                    config,
                    dry_run=args.dry_run,
                    overwrite=args.overwrite,
                )
                for path in files
            ]

        for finding in findings:
            suffix = f" -> {finding.output}" if finding.output else ""
            print(f"{finding.status:22} {finding.file}{suffix}")
            if finding.detail:
                print(f"  {finding.detail}")
        if args.report:
            write_report(findings, args.report.expanduser())
            print(f"Report: {args.report.expanduser()}")
        failed = any(item.status in {"FAIL", "SKIPPED_PROVENANCE"} for item in findings)
        return 2 if failed else 0
    except (ConfigError, ExifToolError, OSError, ToolkitError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
