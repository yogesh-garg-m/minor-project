# Guardian Eye (Sentinel) - Architectural Flow & Technical Specifications

## 1. System Overview

**Guardian Eye** is an AI-powered video threat analysis system that:
- Extracts frames from user-uploaded videos on the client-side
- Sends frames to a serverless backend for AI analysis
- Returns structured threat detection results with timestamps and confidence scores
- Displays interactive results with frame-level anomaly highlighting

---

## 2. End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT BROWSER (React)                  │
│                                                             │
│  Input: Video File (MP4, MOV, AVI, etc.)                   │
│  ├─ Max Size: 100 MB                                        │
│  ├─ FileAPI → HTMLVideoElement                             │
│  ├─ Canvas API Frame Extraction (16 frames)                │
│  └─ Output: Base64 JPEG array + timestamps                 │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ HTTP POST
┌─────────────────────────────────────────────────────────────┐
│              SUPABASE EDGE FUNCTION (Deno)                  │
│              Lovable Cloud Deployment                       │
│                                                             │
│  POST /functions/v1/analyze-video                           │
│  ├─ Input: {frames[], timestamps[], duration}              │
│  ├─ System Prompt: Threat analysis instructions            │
│  ├─ Build Multimodal Content: text + images               │
│  └─ Output: API Request Payload                            │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ HTTPS
┌─────────────────────────────────────────────────────────────┐
│              AI GATEWAY (Lovable Cloud)                     │
│              https://ai.gateway.lovable.dev/v1/...          │
│                                                             │
│  Model: google/gemini-2.5-flash                            │
│  ├─ Multimodal LLM (vision + text)                         │
│  ├─ Low latency inference                                   │
│  └─ Batch process 16 frames + prompt                       │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ Structured Response
┌─────────────────────────────────────────────────────────────┐
│              ANALYSIS RESPONSE (JSON)                        │
│                                                             │
│  {                                                          │
│    "summary": "2-4 sentence description",                  │
│    "bad_event": true/false,                                │
│    "reason": "1-sentence justification",                   │
│    "confidence": 0.0-1.0,                                  │
│    "anomaly_start": seconds (or null),                     │
│    "anomaly_end": seconds (or null),                       │
│    "event_type": "violence|accident|fire|theft|medical|..." │
│  }                                                          │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ HTTP Response (CORS)
┌─────────────────────────────────────────────────────────────┐
│              CLIENT DISPLAY (React Components)              │
│                                                             │
│  ResultsCard Component:                                     │
│  ├─ Threat Status Badge (red/green)                        │
│  ├─ Confidence Score Bar (0-100%)                          │
│  ├─ Summary Text                                            │
│  └─ Frame Timeline with Anomaly Highlighting              │
│      └─ 16 frame thumbnails (anomaly frames: RED border)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Client-Side Frame Extraction Specifications

### File: `src/lib/extractFrames.ts`

| Parameter | Specification | Notes |
|-----------|---------------|-------|
| **Total Frames** | 16 | Fixed count, evenly distributed |
| **Frame Interval** | `duration / 16` seconds | Uniform temporal spacing |
| **Frame Seek Timeout** | 5 seconds per frame | Prevents hanging on corrupted videos |
| **Max Resolution** | 512 px (longest dimension) | Aspect ratio preserved |
| **Format** | JPEG | Compressed format for network efficiency |
| **Quality** | 70% | Balanced between quality and size |
| **Extraction Method** | Canvas API 2D context | `drawImage()` to off-screen canvas |

### Example Calculations

**For a 30-second video:**
- Frame interval: 30 ÷ 16 = **1.875 seconds apart**
- Frame times: 0s, 1.88s, 3.75s, 5.63s, ..., 28.12s
- Resulting frame count: 16 frames
- Total extraction time: ~5–15 seconds (depends on video codec and disk speed)

**For a 2-minute video:**
- Frame interval: 120 ÷ 16 = **7.5 seconds apart**
- Frame times: 0s, 7.5s, 15s, 22.5s, ..., 112.5s
- Total extraction time: ~10–30 seconds

### Frame Processing Pipeline

```
1. Create hidden <video> element
   ├─ Set src to blob URL from FileAPI
   ├─ Set muted=true (audio not needed)
   └─ Set preload="auto"

2. Wait for onloadedmetadata event
   ├─ Read video.duration
   ├─ Validate duration > 0 and isFinite
   └─ Calculate frame interval

3. For each of 16 frames:
   ├─ Calculate target timestamp: i * interval
   ├─ Call seekTo(video, time)
   │  ├─ Set video.currentTime = time
   │  ├─ Wait for onseeked event (or timeout)
   │  └─ Promise-based synchronization
   ├─ Draw frame to canvas: ctx.drawImage(video, 0, 0, ...)
   ├─ Export to data URL: canvas.toDataURL('image/jpeg', 0.7)
   ├─ Store: {dataUrl, timestamp}
   └─ Report progress: onProgress(((i+1)/16) * 100)

4. Cleanup
   ├─ Revoke object URL to free memory
   └─ Return array of 16 ExtractedFrame objects
```

---

## 4. Network Payload Structure

### Request to Edge Function

```json
{
  "frames": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIA...",
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIA...",
    "..."
  ],
  "timestamps": [
    0.0,
    1.875,
    3.75,
    5.625,
    "..."
  ],
  "duration": 30.0
}
```

**Payload Size Estimate:**
- Each frame: ~20–40 KB (JPEG, 512px, 70% quality)
- 16 frames: ~320–640 KB
- Overhead: +5–10%
- **Total: ~350–700 KB per request**

### Response from AI Model

```json
{
  "summary": "A person is walking through a grocery store. At around 15 seconds, they interact with another person. No threatening activity is evident.",
  "bad_event": false,
  "reason": "No harmful or abnormal events detected in the video.",
  "confidence": 0.87,
  "anomaly_start": null,
  "anomaly_end": null,
  "event_type": "none"
}
```

---

## 5. AI Model Specifications

### Google Gemini 2.5 Flash

| Aspect | Details |
|--------|---------|
| **Model ID** | `google/gemini-2.5-flash` |
| **Capabilities** | Multimodal (vision + text) |
| **Input** | Text prompts + Image arrays |
| **Latency** | ~2–5 seconds per request |
| **Batch Processing** | Handles 16 images + prompt simultaneously |
| **Max Images** | Supports 16+ images per request |
| **Vision Resolution** | Processes up to 512×512 (or scaled) |
| **Token Limit** | Sufficient for threat analysis task |
| **Gateway** | Lovable Cloud AI Gateway |

### System Prompt

The AI is instructed to:

1. **Analyze all frames as a video sequence** — understand temporal progression
2. **Categorize threats** — violence, accidents, fire, theft, medical, unsafe behavior
3. **Assign confidence** — 0.0–1.0 based on visual clarity and evidence
4. **Identify time range** — anomaly_start and anomaly_end using frame timestamps
5. **Return structured JSON** — exact schema enforced

**Threat Categories:**
- `violence` — Physical fights, assault, aggression
- `accident` — Falls, collisions, crashes, injuries
- `fire` — Fire, explosions, smoke
- `theft` — Stealing, burglary, suspicious behavior
- `medical` — Collapse, seizure, medical emergency
- `unsafe` — Dangerous stunts, hazardous conditions
- `none` — No threat detected

---

## 6. Time Precision & Anomaly Detection

### Temporal Resolution

The time precision is **limited by the frame interval**:

$$\text{Time Precision} = \frac{\text{Duration}}{16} \text{ seconds}$$

**Examples:**
- 30-second video → ±1.88 seconds precision
- 60-second video → ±3.75 seconds precision
- 100-second video → ±6.25 seconds precision

### Anomaly Time Window

The AI returns:
- `anomaly_start` — Timestamp of the first frame containing the threat
- `anomaly_end` — Timestamp of the last frame containing the threat

**Example Response:**
```json
{
  "anomaly_start": 12.5,
  "anomaly_end": 18.7,
  "summary": "Vehicle reverses into pedestrian at 12–19 seconds"
}
```

The frontend highlights all frames within this window with a **red border** and **pulsing animation**.

---

## 7. Confidence Scoring Mechanism

### Confidence Scale (0.0–1.0)

| Range | Interpretation | Example |
|-------|----------------|---------|
| 0.90–1.00 | **Very High** | Clear, unambiguous violence with multiple frames of evidence |
| 0.70–0.89 | **High** | Strong visual indicators, minor ambiguity |
| 0.50–0.69 | **Moderate** | Some indicators present, reasonable doubt possible |
| 0.30–0.49 | **Low** | Weak indicators, high uncertainty |
| 0.00–0.29 | **Very Low / Uncertain** | Inconclusive or conflicting evidence |

### Confidence Factors

The AI considers:
1. **Visual Clarity** — Sharpness, lighting, resolution of frames
2. **Temporal Consistency** — How many frames confirm the event
3. **Event Severity** — How obviously harmful the behavior is

### Important Notes

- Confidence is **model-generated**, not a calibrated statistical probability
- Treat as a **relative signal**, not absolute certainty
- Higher confidence = more visual evidence and consistency
- Lower confidence = ambiguous or partial evidence

---

## 8. Error Handling & HTTP Status Codes

### Response Status Codes

| Status | Condition | Message |
|--------|-----------|---------|
| **200** | Success | Analysis complete, JSON returned |
| **400** | Bad Request | No frames provided or invalid payload |
| **402** | Payment Required | AI usage credits exhausted |
| **429** | Too Many Requests | Rate limit exceeded (per-workspace) |
| **500** | Server Error | Internal error or AI gateway failure |

### Error Response Example

```json
{
  "error": "Rate limit exceeded. Please try again later."
}
```

---

## 9. Performance Characteristics

### Client-Side Metrics

| Operation | Duration | Notes |
|-----------|----------|-------|
| **Video Load & Parse** | 1–2 seconds | Depends on file size and disk speed |
| **Frame Extraction** | 5–15 seconds | HTMLVideoElement seek + canvas draw |
| **Base64 Encoding** | 1–2 seconds | 16 frames to data URLs |
| **Network Upload** | 2–5 seconds | 350–700 KB payload @ typical bandwidth |
| **Total Client → Network** | ~10–25 seconds | Highly variable based on video codec |

### Backend Metrics

| Operation | Duration | Notes |
|-----------|----------|-------|
| **Request Parsing** | <100 ms | Deno JSON parse |
| **Content Building** | <500 ms | Constructing multimodal payload |
| **AI Model Inference** | 2–5 seconds | Gemini 2.5 Flash processing 16 images |
| **Response Parsing** | <200 ms | JSON extraction from AI response |
| **Total Backend** | ~2–6 seconds | Dominated by AI model latency |

### End-to-End Latency

```
Total Time = Client Extraction + Network Upload + Backend Processing + Network Download
           = (10–25s) + (2–5s) + (2–6s) + (<1s)
           = 14–37 seconds
```

---

## 10. Limits & Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Max Video Size | 100 MB | Browser memory, network efficiency |
| Frames Extracted | 16 fixed | Balance: detail vs. processing speed |
| Frame Resolution | 512 px max | Sufficient for threat detection, reduces payload |
| Frame Format | JPEG 70% | Compression, network speed |
| Frame Interval Precision | ±duration/16 | Temporal resolution trade-off |
| Seek Timeout | 5 seconds | Prevents infinite hangs |
| No Authentication | Public endpoint | Design choice for demo/MVP |
| No Persistence | Stateless | Results not stored in database |
| Rate Limiting | Per-workspace (AI Gateway) | Prevents abuse |
| Credit Limit | Per-workspace quota (402 error) | Usage tracking via AI Gateway |

---

## 11. Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend Framework** | React 18 | UI component rendering |
| **Language** | TypeScript | Type safety, developer experience |
| **Build Tool** | Vite | Fast bundling and HMR |
| **Styling** | Tailwind CSS | Utility-first CSS framework |
| **UI Components** | shadcn/ui (Radix) | Accessible, composable components |
| **State Management** | React Query | Server state + caching |
| **Routing** | React Router | Client-side navigation |
| **Backend Runtime** | Deno | Secure TypeScript runtime |
| **Backend Framework** | Supabase Edge Functions | Serverless deployment |
| **AI Model** | Google Gemini 2.5 Flash | Multimodal threat analysis |
| **AI Gateway** | Lovable Cloud | Model routing + API management |
| **Deployment** | Lovable Cloud | Full-stack hosting |

---

## 12. Key Components & Responsibilities

### Frontend Components

**[VideoUpload.tsx](src/components/VideoUpload.tsx)**
- Drag-and-drop file input
- File validation (size, format, MIME type)
- Pass file to extractFrames

**[ProcessingStatus.tsx](src/components/ProcessingStatus.tsx)**
- Show extraction progress: 0–100%
- Display status messages ("Extracting...", "Analyzing...", etc.)
- Handle error UI

**[ResultsCard.tsx](src/components/ResultsCard.tsx)**
- Display threat status (green/red badge)
- Confidence score visualization (progress bar)
- Show summary text
- Render frame timeline with timestamps

**[main.tsx](src/main.tsx) → [Index.tsx](src/pages/Index.tsx)**
- App orchestration
- Call extractFrames → trigger API request → display results
- Error boundary, loading states

### Backend Functions

**[analyze-video/index.ts](supabase/functions/analyze-video/index.ts)**
- Parse request: `{frames[], timestamps[], duration}`
- Build multimodal content array (text + images with labels)
- Call AI Gateway with Gemini model
- Parse and validate JSON response
- Return structured AnalysisResult
- Error handling for all status codes

---

## 13. Data Flow Sequence Diagram

```
User                Browser             Edge Fn            AI Gateway
  │                   │                    │                    │
  ├──► drop video ───>│                    │                    │
  │                   │                    │                    │
  │                   ├─► extract frames   │                    │
  │                   │   (16 × canvas)    │                    │
  │                   │                    │                    │
  │                   ├─► show progress    │                    │
  │                   │   (0–100%)         │                    │
  │                   │                    │                    │
  │                   ├─► HTTP POST ──────>│                    │
  │                   │   ({frames, ts})   │                    │
  │                   │                    │                    │
  │                   │                    ├─► build multimodal │
  │                   │                    │   content          │
  │                   │                    │                    │
  │                   │                    ├─► HTTP POST ──────>│
  │                   │                    │   (Gemini 2.5)     │
  │                   │                    │                    │
  │                   │                    │                    ├─► inference
  │                   │                    │                    │   (2–5s)
  │                   │                    │                    │
  │                   │                    │<──── JSON response │
  │                   │                    │                    │
  │                   │<──── JSON response │                    │
  │                   │   (AnalysisResult) │                    │
  │                   │                    │                    │
  │                   ├─► render results   │                    │
  │                   │   (badge, bar,     │                    │
  │                   │    timeline)       │                    │
  │                   │                    │                    │
  │<──── display ─────┤                    │                    │
  │   (threat/safe)   │                    │                    │
  │                   │                    │                    │
```

---

## 14. Architecture Highlights

### Strengths

✅ **Distributed Processing:**
- Client extracts frames (fast, offloads from server)
- Server orchestrates AI analysis (serverless, scalable)
- AI Gateway manages model routing and rate limits

✅ **Low Latency:**
- Gemini 2.5 Flash is optimized for speed
- 16-frame batch keeps payload manageable
- JPEG compression reduces bandwidth

✅ **Stateless Design:**
- No database required for results
- Each request is independent
- Easy to scale horizontally

✅ **Flexible Threat Detection:**
- Vision + text multimodal analysis
- 7 threat categories
- Confidence scoring for risk assessment

✅ **Privacy-First:**
- No persistent storage of videos or frames
- Analysis happens server-side, results returned once
- Client extracts frames locally (not uploaded raw)

### Trade-offs

⚠️ **Frame Resolution Limit:**
- 512 px max imposes small threats difficult to detect
- Trade-off between detail and bandwidth

⚠️ **Fixed 16 Frames:**
- May miss rapid anomalies (> 1.9 sec precision for 30s video)
- Cannot adjust for different video types

⚠️ **No Persistence:**
- Results disappear after response
- No audit trail or historical analysis

⚠️ **Public Endpoint:**
- No authentication requirement (intentional design choice)
- Relies on AI Gateway rate limiting for abuse prevention

---

## 15. Extension Points for Future Development

1. **Variable Frame Count** — Allow users to extract 8, 16, 32, or 64 frames
2. **Database Persistence** — Store results + metadata for audit/analytics
3. **Customizable Threat Categories** — Industry-specific threat definitions
4. **Real-Time Streaming** — Process video frames as they arrive (WebRTC)
5. **Batch Processing API** — Analyze multiple videos in one request
6. **Authentication & Authorization** — Per-user quotas, API keys
7. **Advanced Filtering** — False positive reduction, severity scoring
8. **Model Switching** — Support Claude, GPT-4V, or other vision models
9. **Webhook Integration** — Notify external systems of detected threats
10. **Analytics Dashboard** — Threat trends, detection accuracy metrics

---

## Summary

Guardian Eye is a **lightweight, event-driven AI system** for video threat analysis. It combines:
- **Client-side efficiency** (frame extraction with Canvas API)
- **Serverless scalability** (Supabase + Deno Edge Functions)
- **Multimodal AI analysis** (Gemini 2.5 Flash vision)
- **Precise anomaly detection** (timestamped frame labeling)
- **Simple but powerful results** (structured JSON with confidence scoring)

**Typical flow:** Upload (~1s) → Extract frames (~10s) → Analyze (~5s) → Display results (~2s) = **~18 seconds end-to-end**.

The architecture prioritizes **speed, simplicity, and scalability** over persistence, authentication, or real-time processing—making it ideal for anomaly detection in archived video content.
