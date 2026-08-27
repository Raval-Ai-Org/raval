"""Unit tests for security module (authentication, signing, encryption)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.security import (
    InvalidTokenError,
    ReplayAttackError,
    SecurityError,
    decrypt_token,
    encrypt_token,
    generate_request_id,
    hash_password,
    sign_request,
    validate_bearer_token,
    validate_timestamp_freshness,
    verify_password,
    verify_signature,
)


class TestRequestID:
    """Tests for request ID generation."""

    def test_generates_uuid_string(self):
        """Request ID should be a valid UUID string (36 chars)."""
        request_id = generate_request_id()
        assert len(request_id) == 36
        assert request_id.count("-") == 4

    def test_generates_unique_ids(self):
        """Each request ID should be unique."""
        ids = {generate_request_id() for _ in range(100)}
        assert len(ids) == 100


class TestBearerTokenValidation:
    """Tests for Bearer token validation."""

    def test_valid_token(self):
        """Valid Bearer token should return token string."""
        import app.config as config_mod
        from app.config import Settings

        # Override the global settings singleton
        original = config_mod.settings
        config_mod.settings = Settings(
            SDE_API_TOKEN="test-token-min-16chars",
            SDE_SIGNING_SECRET="test-signing-secret-32-bytes-long-req",
            FERNET_KEY="CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY=",
        )
        try:
            result = validate_bearer_token("Bearer test-token-min-16chars")
            assert result == "test-token-min-16chars"
        finally:
            config_mod.settings = original

    def test_missing_header(self):
        """Missing Authorization header raises InvalidTokenError."""
        with pytest.raises(InvalidTokenError, match="Missing Authorization header"):
            validate_bearer_token(None)

    def test_empty_header(self):
        """Empty Authorization header raises InvalidTokenError."""
        with pytest.raises(InvalidTokenError, match="Missing Authorization header"):
            validate_bearer_token("")

    def test_wrong_scheme(self):
        """Non-Bearer scheme raises InvalidTokenError."""
        with pytest.raises(InvalidTokenError, match="Invalid Authorization header format"):
            validate_bearer_token("Basic dXNlcjpwYXNz")

    def test_missing_token(self):
        """Authorization without token raises InvalidTokenError."""
        with pytest.raises(InvalidTokenError, match="Invalid Authorization header format"):
            validate_bearer_token("Bearer")

    def test_invalid_token(self):
        """Token mismatch raises InvalidTokenError."""
        import app.config as config_mod
        from app.config import Settings

        # Temporarily override settings
        original_settings = config_mod.settings
        config_mod.settings = Settings(
            SDE_API_TOKEN="real-token-min-16chars",
            SDE_SIGNING_SECRET="test-signing-secret-32-bytes-long-req",
            FERNET_KEY="CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY=",
        )
        try:
            with pytest.raises(InvalidTokenError, match="Invalid or expired token"):
                validate_bearer_token("Bearer wrong-token")
        finally:
            config_mod.settings = original_settings


class TestHMACSigning:
    """Tests for HMAC-SHA256 request signing."""

    def test_sign_request_returns_hex(self):
        """Signature should be in sha256=hex format."""
        sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret123")
        assert sig.startswith("sha256=")
        # Hex portion after sha256=
        hex_part = sig.split("=", 1)[1]
        assert len(hex_part) == 64  # SHA256 hex output is 64 chars

    def test_sign_request_deterministic(self):
        """Same inputs should produce same signature."""
        sig1 = sign_request("GET", "/healthz", "", "secret")
        sig2 = sign_request("GET", "/healthz", "", "secret")
        assert sig1 == sig2

    def test_different_methods_different_signatures(self):
        """Different HTTP methods should produce different signatures."""
        sig1 = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        sig2 = sign_request("GET", "/webhook", '{"event":"test"}', "secret")
        assert sig1 != sig2

    def test_different_bodies_different_signatures(self):
        """Different bodies should produce different signatures."""
        sig1 = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        sig2 = sign_request("POST", "/webhook", '{"event":"other"}', "secret")
        assert sig1 != sig2

    def test_different_secrets_different_signatures(self):
        """Different secrets should produce different signatures."""
        sig1 = sign_request("POST", "/webhook", '{"event":"test"}', "secret1")
        sig2 = sign_request("POST", "/webhook", '{"event":"test"}', "secret2")
        assert sig1 != sig2

    def test_bytes_body(self):
        """Signature should work with bytes body."""
        sig = sign_request("POST", "/webhook", b'{"event":"test"}', "secret")
        assert sig.startswith("sha256=")

    def test_empty_body(self):
        """Empty body should produce valid signature."""
        sig = sign_request("GET", "/healthz", "", "secret")
        assert sig.startswith("sha256=")


class TestSignatureVerification:
    """Tests for HMAC signature verification."""

    def test_valid_signature_verified(self):
        """Valid signature should return True."""
        sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        result = verify_signature("POST", "/webhook", '{"event":"test"}', sig, "secret")
        assert result is True

    def test_invalid_signature_rejected(self):
        """Invalid signature should return False."""
        sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret1")
        result = verify_signature("POST", "/webhook", '{"event":"test"}', sig, "secret2")
        assert result is False

    def test_tampered_body_rejected(self):
        """Tampered body should fail verification."""
        sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        result = verify_signature("POST", "/webhook", '{"event":"TAMPERED"}', sig, "secret")
        assert result is False

    def test_tampered_method_rejected(self):
        """Different method should fail verification."""
        sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        result = verify_signature("GET", "/webhook", '{"event":"test"}', sig, "secret")
        assert result is False


class TestFernetEncryption:
    """Tests for Fernet token encryption/decryption."""

    FERNET_KEY = "CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY="

    def test_encrypt_returns_bytes(self):
        """Encrypted token should be bytes."""
        encrypted = encrypt_token("oauth_token_123", self.FERNET_KEY)
        assert isinstance(encrypted, bytes)
        assert len(encrypted) > 0

    def test_decrypt_returns_original_token(self):
        """Decrypted token should match original."""
        original = "oauth_token_123"
        encrypted = encrypt_token(original, self.FERNET_KEY)
        decrypted = decrypt_token(encrypted, self.FERNET_KEY)
        assert decrypted == original

    def test_roundtrip_with_special_chars(self):
        """Roundtrip works with special characters."""
        original = "ya29.a0AfH6SMAAAAA-abcdefghijklmnopqrstuvwxyz_+/="
        encrypted = encrypt_token(original, self.FERNET_KEY)
        decrypted = decrypt_token(encrypted, self.FERNET_KEY)
        assert decrypted == original

    def test_different_tokens_produce_different_ciphertext(self):
        """Different tokens should produce different ciphertexts."""
        e1 = encrypt_token("token_a", self.FERNET_KEY)
        e2 = encrypt_token("token_b", self.FERNET_KEY)
        assert e1 != e2

    def test_different_key_fails_decryption(self):
        """Wrong key should fail decryption."""
        encrypted = encrypt_token("secret_token", self.FERNET_KEY)
        wrong_key = "QXJ1UjV3eDlGc0dhM0htSmFMYmNrT3dOa1FZczJUZ2s="
        with pytest.raises(SecurityError, match="Token decryption failed"):
            decrypt_token(encrypted, wrong_key)

    def test_empty_string_roundtrip(self):
        """Empty string should roundtrip successfully."""
        encrypted = encrypt_token("", self.FERNET_KEY)
        decrypted = decrypt_token(encrypted, self.FERNET_KEY)
        assert decrypted == ""


class TestTimestampFreshness:
    """Tests for replay protection."""

    def test_current_timestamp_valid(self):
        """Current timestamp should be valid."""
        now = datetime.now(UTC)
        assert validate_timestamp_freshness(now) is True

    def test_one_minute_ago_valid(self):
        """1 minute old timestamp should be valid (within 300s tolerance)."""
        past = datetime.now(UTC) - timedelta(seconds=60)
        assert validate_timestamp_freshness(past) is True

    def test_five_minutes_ago_valid(self):
        """5 minute old timestamp should be valid (default tolerance)."""
        # Use 290s to avoid race condition at exact boundary
        past = datetime.now(UTC) - timedelta(seconds=290)
        assert validate_timestamp_freshness(past) is True

    def test_six_minutes_ago_invalid(self):
        """6 minute old timestamp should be invalid (exceeds 300s tolerance)."""
        past = datetime.now(UTC) - timedelta(seconds=360)
        assert validate_timestamp_freshness(past) is False

    def test_custom_tolerance(self):
        """Custom tolerance should override default."""
        past = datetime.now(UTC) - timedelta(seconds=600)
        assert validate_timestamp_freshness(past, tolerance_seconds=900) is True

    def test_future_timestamp_rejected(self):
        """Timestamp >60s in future should raise ReplayAttackError."""
        future = datetime.now(UTC) + timedelta(seconds=120)
        with pytest.raises(ReplayAttackError, match="too far in the future"):
            validate_timestamp_freshness(future)

    def test_slightly_future_timestamp_valid(self):
        """Timestamp slightly in future (clock skew) should be valid."""
        slightly_future = datetime.now(UTC) + timedelta(seconds=30)
        assert validate_timestamp_freshness(slightly_future) is True


class TestPasswordHashing:
    """Tests for password hashing (utility)."""

    def test_hash_returns_hex(self):
        """Hash should return 64 char hex string."""
        hashed = hash_password("mypassword")
        assert len(hashed) == 64
        assert all(c in "0123456789abcdef" for c in hashed)

    def test_hash_deterministic(self):
        """Same password should hash to same value."""
        h1 = hash_password("mypassword")
        h2 = hash_password("mypassword")
        assert h1 == h2

    def test_different_passwords_different_hashes(self):
        """Different passwords should produce different hashes."""
        h1 = hash_password("password1")
        h2 = hash_password("password2")
        assert h1 != h2

    def test_verify_correct_password(self):
        """Correct password should verify."""
        hashed = hash_password("mypassword")
        assert verify_password("mypassword", hashed) is True

    def test_verify_incorrect_password(self):
        """Incorrect password should not verify."""
        hashed = hash_password("mypassword")
        assert verify_password("wrongpassword", hashed) is False
