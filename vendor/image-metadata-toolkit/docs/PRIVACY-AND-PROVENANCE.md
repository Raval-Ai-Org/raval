# Privacy and provenance

EXIF/XMP metadata, C2PA Content Credentials, and invisible watermarking systems are different technologies.

The toolkit can audit and clean conventional metadata such as GPS, camera model, device serial, owner, comments, and software fields. It can write XMP creator and rights metadata. It does not claim to remove SynthID or other invisible watermarks.

C2PA credentials can cryptographically bind assertions to an asset. Even if a credential container can be copied byte-for-byte, editing the file may make its validation status misleading or invalid. For that reason, the default policy reports detected provenance and refuses the write.

Only use `allow-metadata-change` when:

1. you own or are authorized to modify the image;
2. you have separately preserved the original;
3. you understand the credential may no longer validate; and
4. your goal is ordinary publishing metadata—not evasion or misrepresentation.

The audit is conservative but not a substitute for a dedicated C2PA validator.
