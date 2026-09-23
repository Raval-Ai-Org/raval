from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from image_metadata_toolkit.config import ConfigError, load_config, resolved_ownership
from image_metadata_toolkit.core import (
    clean_file,
    inspect_file,
    privacy_findings,
    provenance_findings,
    rendering_signature,
    sha256,
    verify_file,
)

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised by minimal installations
    Image = None


class ConfigurationTests(unittest.TestCase):
    def test_rights_placeholders_are_resolved(self) -> None:
        config = load_config(None)
        ownership = config["ownership"]
        assert isinstance(ownership, dict)
        ownership.update(
            {
                "creator": "Example Creator",
                "publisher": "Example Publisher",
                "website_url": "https://example.com/",
                "credit": "Example Creator / Example.com",
            }
        )
        self.assertIn("Example Creator", str(resolved_ownership(config)["rights_notice"]))

    def test_invalid_url_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"ownership": {"website_url": "not-a-url"}}))
            with self.assertRaises(ConfigError):
                load_config(path)

    def test_privacy_and_provenance_classification(self) -> None:
        metadata = {
            "[EXIF]Make": "Camera",
            "[GPS]GPSLatitude": "1 deg N",
            "[JUMBF]JUMBF": "C2PA manifest",
            "[File]FileName": "example.jpg",
        }
        self.assertEqual(privacy_findings(metadata), ["[EXIF]Make", "[GPS]GPSLatitude"])
        self.assertIn("[JUMBF]JUMBF", provenance_findings(metadata))


@unittest.skipUnless(shutil.which("exiftool") and Image is not None, "ExifTool and Pillow required")
class IntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source_dir = self.root / "source"
        self.output_dir = self.root / "output"
        self.source_dir.mkdir()
        self.output_dir.mkdir()
        self.config = load_config(None)
        ownership = self.config["ownership"]
        content = self.config["content"]
        assert isinstance(ownership, dict) and isinstance(content, dict)
        ownership.update(
            {
                "creator": "Example Creator",
                "publisher": "Example Publisher",
                "website_url": "https://example.com/creator/",
                "credit": "Example Creator / Example Publisher",
            }
        )
        content.update(
            {
                "title": "Example Image",
                "description": "A generated image used for metadata integration testing.",
                "subjects": ["metadata", "privacy", "testing"],
            }
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _make_image(self, suffix: str) -> Path:
        path = self.source_dir / f"sample{suffix}"
        image = Image.new("RGB", (24, 16), color=(32, 96, 160))
        save_format = {".jpg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[suffix]
        image.save(path, format=save_format)
        return path

    def test_webp_jpeg_png_clean_verify_without_source_changes(self) -> None:
        for suffix in (".webp", ".jpg", ".png"):
            with self.subTest(suffix=suffix):
                source = self._make_image(suffix)
                before_hash = sha256(source)
                before_signature = rendering_signature(source)
                destination = self.output_dir / source.name
                result = clean_file(
                    source,
                    destination,
                    self.config,
                    dry_run=False,
                    overwrite=False,
                )
                self.assertEqual(result.status, "PASS", result.detail)
                self.assertEqual(sha256(source), before_hash)
                self.assertEqual(rendering_signature(destination), before_signature)
                verified = verify_file(destination, self.config)
                self.assertEqual(verified.status, "PASS", verified.detail)
                self.assertEqual(verified.creator, "Example Creator")
                self.assertEqual(verified.title, "Example Image")

    def test_private_metadata_is_removed_from_jpeg_copy(self) -> None:
        source = self._make_image(".jpg")
        subprocess.run(
            [
                shutil.which("exiftool"),
                "-overwrite_original",
                "-Make=Private Camera",
                "-Model=Device 123",
                "-SerialNumber=SECRET",
                "-OwnerName=Private Owner",
                "-GPSLatitude=40 42 46.08",
                "-GPSLatitudeRef=N",
                "-GPSLongitude=74 0 21.6",
                "-GPSLongitudeRef=W",
                str(source),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        before_hash = sha256(source)
        self.assertTrue(inspect_file(source).private_tags)
        destination = self.output_dir / source.name
        result = clean_file(source, destination, self.config, dry_run=False, overwrite=False)
        self.assertEqual(result.status, "PASS", result.detail)
        self.assertEqual(sha256(source), before_hash)
        self.assertFalse(inspect_file(destination).private_tags)

    def test_existing_output_requires_explicit_overwrite(self) -> None:
        source = self._make_image(".png")
        destination = self.output_dir / source.name
        destination.write_bytes(b"existing working output")
        before = sha256(destination)
        result = clean_file(source, destination, self.config, dry_run=False, overwrite=False)
        self.assertEqual(result.status, "FAIL")
        self.assertEqual(sha256(destination), before)


if __name__ == "__main__":
    unittest.main()
