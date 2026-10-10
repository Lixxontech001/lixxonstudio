# Test fixtures (not content)

`video-test-article.json` is the fixture for the owner's **test render** (`scripts/render-video-test.mjs`, run by
`.github/workflows/video-render-test.yml`). It is not an article, it is not published, and it is not a reader video.

- `status` is `fixture_only`, `mode` is `test`, and `article_id` says "do not publish".
- The render adds a **TEST ONLY** title and watermark. Its metadata says `approval_eligible=false` and `publish_eligible=false`.
- The test render is **silent on purpose**. The render uses `-an`, so the MP4 has no audio track. The fixture says so too (`muted MP4 metadata contract`).
- That silence is a test-only property. **Reader videos and pack videos always have sound.** `scripts/pack-video.mjs` always
  adds a voice track (Gemini voice first, then a local espeak voice). With no voice it makes no file. The saver,
  `scripts/save-pack-media.mjs`, refuses any MP4 with no audio track (`no_audio`), and the Phase 8 freeze pins that.
  `scripts/video-asset-validation.mjs` is the opposite check: it requires this test fixture to be silent. Nothing from
  this fixture goes into a pack.

Do not copy this fixture into a real article or a pack. Do not treat a test render as a finished video.
