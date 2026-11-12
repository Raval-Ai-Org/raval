# Local AI sidecar: licences

Every model and library the sidecar runs allows commercial use. Check this
table before adding or swapping one.

| Job                        | Component                                         | Licence    | Source                                                     |
| -------------------------- | ------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Product cut-out            | BiRefNet-lite (`birefnet-general-lite` via rembg) | MIT        | github.com/ZhengPeng7/BiRefNet                             |
| Cut-out runner             | rembg (library only)                              | MIT        | github.com/danielgatis/rembg                               |
| OCR                        | RapidOCR (PaddleOCR mobile models in ONNX)        | Apache-2.0 | github.com/RapidAI/RapidOCR                                |
| Image safety               | Falconsai/nsfw_image_detection (ViT)              | Apache-2.0 | huggingface.co/Falconsai/nsfw_image_detection              |
| Aesthetic score            | improved-aesthetic-predictor (MLP head)           | Apache-2.0 | github.com/christophschuhmann/improved-aesthetic-predictor |
| Aesthetic backbone         | OpenAI CLIP ViT-L/14                              | MIT        | huggingface.co/openai/clip-vit-large-patch14               |
| Voiceover                  | Kokoro-82M (kokoro-onnx)                          | Apache-2.0 | huggingface.co/hexgrad/Kokoro-82M                          |
| Phonemes                   | espeak-ng (a separate program, server-side only)  | GPL-3.0    | github.com/espeak-ng/espeak-ng                             |
| Transcription (main image) | whisper.cpp + ggml base model                     | MIT        | github.com/ggml-org/whisper.cpp                            |

## Never use these

Their licences rule out commercial use, or are unclear:

- BRIA RMBG 1.4/2.0, which is rembg's **default** model, so always pass `birefnet-general-lite`;
- @imgly background removal (AGPL);
- NudeNet;
- MusicGen (CC-BY-NC);
- F5-TTS and XTTS (non-commercial weights);
- Q-Align, CLIP-IQA code, pyiqa.
