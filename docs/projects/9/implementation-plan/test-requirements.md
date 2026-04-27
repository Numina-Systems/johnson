# GH09 Image Viewing Tool — Test Requirements

This document maps each acceptance criterion from the design to specific automated tests or documented human verification.

## Automated Tests

| AC ID | Criterion | Test Type | Test File | Description |
|-------|-----------|-----------|-----------|-------------|
| GH09.AC1.1 | view_image fetches URL, validates content-type starts with image/ (success) | Unit | `src/tools/image.test.ts` | Mock fetch returning image/png with valid PNG bytes; verify ImageResult returned with correct fields |
| GH09.AC1.2 | view_image rejects non-image content-type | Unit | `src/tools/image.test.ts` | Mock fetch returning text/html; verify Error thrown with "Not an image" |
| GH09.AC1.3 | view_image rejects HTTP errors | Unit | `src/tools/image.test.ts` | Mock fetch returning 404; verify Error thrown with "HTTP 404" |
| GH09.AC2.1 | Rejects images > 10MB via content-length header | Unit | `src/tools/image.test.ts` | Mock fetch with content-length: 20000000; verify Error thrown with "too large" before body read |
| GH09.AC2.2 | Rejects images > 10MB via actual body size | Unit | `src/tools/image.test.ts` | Mock fetch with no content-length, arrayBuffer returning >10MB; verify Error thrown with "too large" |
| GH09.AC3.1 | Returns base64-encoded image with correct media type | Unit | `src/tools/image.test.ts` | Mock fetch returning known PNG bytes; verify data field matches Buffer.from(bytes).toString('base64') and media_type is 'image/png' |
| GH09.AC4.1 | Agent loop formats image result as multi-content ToolResultBlock | Unit | `src/agent/agent.test.ts` | Call formatNativeToolResult with ImageResult; verify content is array of length 2 |
| GH09.AC4.2 | Text block in image tool result contains descriptive text | Unit | `src/agent/agent.test.ts` | Verify content[0] is { type: 'text', text: ImageResult.text } |
| GH09.AC4.3 | Image block contains correct source data | Unit | `src/agent/agent.test.ts` | Verify content[1] has type 'image' with correct source.type, media_type, data |
| GH09.AC5.1 | Non-image string results stringify normally | Unit | `src/agent/agent.test.ts` | Call formatNativeToolResult with string; verify content is that string |
| GH09.AC5.2 | Non-image object results JSON-stringify | Unit | `src/agent/agent.test.ts` | Call formatNativeToolResult with object; verify content is JSON.stringify(object) |
| GH09.AC6.1 | 30s fetch timeout | Unit | `src/tools/image.test.ts` | Verify fetch is called with signal (AbortSignal) argument |
| GH09.AC7.1 | Registered as mode: 'native' only | Unit | `src/tools/image.test.ts` | Call registerImageTools with mock registry; verify register called with mode 'native' |
| GH09.AC8 | Image content blocks trimmed in older context messages | Unit | `src/agent/agent.test.ts` | Build history with old image tool result; call trimOldToolResults; verify replaced with placeholder |

## Human Verification

| AC ID | Criterion | Why Not Automated | Verification Approach |
|-------|-----------|-------------------|----------------------|
| GH09.AC_E2E | End-to-end: model sees image and responds about it | Requires live model API call + real image hosting | Manual test: run agent, ask it to view a known image URL (e.g., a PNG on a public CDN), verify the model describes the image content correctly in its response |

## Test File Summary

| File | Test Count | Covers |
|------|-----------|--------|
| `src/tools/image.test.ts` | 7-8 tests | AC1.1, AC1.2, AC1.3, AC2.1, AC2.2, AC3.1, AC6.1, AC7.1 |
| `src/agent/agent.test.ts` | 7-8 tests | AC4.1, AC4.2, AC4.3, AC5.1, AC5.2, AC8 |
