If I have a split wise like app for keeping track of payments between people, 
How can I integrate an image recognition?
So you can upload receipts from groceries, restaurants, etc. and have them converted into list of items for people to split between each other
Recalled memory

For receipts specifically, the approach that works best now is a multimodal LLM with a forced JSON schema, not classic OCR. Tesseract or a plain OCR API gives you a jumble of text lines and you end up writing brittle regex to guess which ones are items. Dedicated receipt APIs (Veryfi, Taggun, Mindee, AWS Textract AnalyzeExpense, Google Document AI) are tuned mostly for merchant/date/total — good for expense reports, weaker at clean line-item extraction, which is exactly the part you need.

Pipeline shape

    Capture — use the platform document scanner rather than a raw camera picker: VNDocumentCameraViewController on iOS, ML Kit Document Scanner on Android. It handles edge detection, deskew, and perspective correction on-device. This single step improves accuracy more than any model choice.
    Preprocess — downscale to ~1500px on the long edge, JPEG q80. Long grocery receipts are the exception: they need height, so consider splitting tall images into overlapping vertical tiles.
    Upload to object storage (S3/R2) via a signed URL, return an ID immediately.
    Parse in a background job — queue it, don't block the request. Vision calls take 3–10s.
    Review UI — always land in an editable table, never auto-commit. Extraction is ~90–95% right on clean receipts, and the 5% is where users lose trust.
    Assign & split once confirmed.

Schema

Ask for strict JSON, nulls instead of guesses:
json

{
  "merchant": "string|null",
  "purchased_at": "ISO 8601|null",
  "currency": "ISO 4217",
  "items": [{
    "raw_text": "verbatim line from receipt",
    "name": "cleaned name",
    "quantity": 2,
    "unit_price_minor": 599,
    "total_price_minor": 1198,
    "category": "food|alcohol|household|other"
  }],
  "subtotal_minor": 0,
  "tax_minor": 0,
  "tip_minor": 0,
  "discounts_minor": 0,
  "total_minor": 0,
  "confidence": 0.0
}

Keeping raw_text alongside the cleaned name is worth it — when a user says "that's wrong," you can show them the original line, and it gives you training/eval data later.

Cases that will bite you

    Quantity > 1. "3× Beer 18.00" should be splittable as three units across different people, not one lump. Model your item as {unit_price, quantity} and let assignment work at unit granularity.
    Weighted items. "0.734 kg bananas @ 2.19" — quantity isn't an integer. Store quantity as a decimal and disable unit-level splitting when it's fractional.
    Negative lines. Loyalty discounts, coupons, deposit returns. These are items with negative totals, and they need to be allocated too.
    Deposits/fees. Bottle deposits in BG and most of the EU appear as separate lines tied to a product.
    Validation. Always check sum(items) + tax + tip - discounts == total. If it doesn't reconcile, surface a banner rather than silently accepting. This catches most extraction failures for free, and it's a better quality signal than the model's own confidence score.

The allocation math

This is the part people underestimate. Once items are assigned, tax and tip get distributed pro-rata by each person's item subtotal — and naive rounding means the parts won't sum to the total. Use largest-remainder: compute exact shares in minor units, floor them all, then hand out the leftover cents one at a time to whoever has the largest fractional remainder. Do everything in integer minor units (cents/stotinki) and never touch floats.

Shared items (a bottle of wine for the table) need an "assign to N people" mode that divides the same way.

Cost and practicalities

A downscaled receipt image runs roughly 1–2k input tokens, so per-parse cost is fractions of a cent to a couple of cents depending on model. Cache aggressively by image hash — people re-upload the same receipt. Set a retry with a different prompt or higher resolution when reconciliation fails, before falling back to manual entry.

Privacy — receipts carry card last-4, sometimes loyalty IDs and names. Decide early whether you retain the image after parsing; if you do, encrypt at rest and give users a delete path. If not, discard after the review step is confirmed.

One design suggestion: don't make receipt scanning the primary flow. Make it a fast path into your existing manual-entry screen, so a failed parse degrades into ordinary typing rather than a dead end.

What LLM models can I use? What's industry standard for professional app? What's mid range for simpler projects?
Then what's the free tier I can use for hobby project
Searched the web, viewed a file

Worth separating two things first: general-purpose vision LLMs and dedicated receipt APIs. For expense products, the actual industry standard is often the latter — Veryfi, Mindee, Klippa, Taggun, AWS Textract AnalyzeExpense. They bill per document (roughly $0.02–0.10), come with SLAs and a DPA, and need no prompt engineering. The tradeoff is exactly what I mentioned before: they're tuned for merchant/date/total, and line-item quality on messy restaurant receipts is inconsistent. Most newer splitting apps have moved to vision LLMs for that reason.

Assuming you go the LLM route:
Production tier

All current Claude models support image input and vision, and the same is true across the Gemini and GPT lineups, so the choice is about price/quality, not capability.
Claude Platform Docs
Model	Input / output per 1M tokens
Claude Sonnet 5	$2 / $10
GPT-5.6 Terra	~$2 / $12
Gemini 3.6 or 3.7 Flash	$0.75 / $3.75 through end of 2026, then $1.50 / $7.50

Any of these will handle receipts well. Gemini Flash is currently the cheapest of the three by a wide margin because of the promotional rate — but note that price roughly doubles on January 1, 2027, so don't build margins on it.

Don't reach for the flagship tier (Claude Opus 5 at $5/$25, Fable 5 at $10/$50, GPT-5.6 Sol at $5/$30, Gemini 3.1 Pro at $2/$12). Receipt extraction is structured extraction from a short document — it's not a reasoning-hard task. Your accuracy ceiling is set by image quality, prompt design, and your reconciliation check, not by model tier. Spend the money on the capture UX instead.
Mid-range
Model	Input / output per 1M tokens
Claude Haiku 4.5	$1 / $5
GPT-5.6 Luna	~$0.20 / $1.20
Gemini 3.5 Flash-Lite	$0.30 / $2.50
Gemini 3.1 Flash-Lite	$0.25 (text/image/video) / $1.50
Gemini 2.5 Flash-Lite	$0.10 / $0.40

Honestly, this is where I'd start for a splitting app. Run your own eval — 30–50 real receipts, measure line-item recall and how often the totals reconcile — and only move up a tier if a Lite model actually fails.

Rough per-receipt math. A 1500px receipt is ~1,000–1,500 image tokens; JSON for a 20-item grocery run is ~600–800 output tokens. On Gemini 3.1 Flash-Lite that's about $0.0015 per receipt — 10,000 receipts/month for ~$15. On Sonnet 5 the same receipt is ~$0.011, so about 7× more. At hobby volume the difference is invisible; at scale it's the whole budget.

Two levers that matter more than model choice: batch mode halves everything on all three providers, and since your prompt (schema + instructions) is identical every call, prompt caching cuts the repeated portion to ~10% of input price.
Free tier

Google's is the only genuinely usable one. Gemini's free tier gives free input and output tokens on selected models with Google AI Studio access, in exchange for your content being used to improve their products — the paid tier explicitly does not use content for that. Free-tier models include the Flash and Flash-Lite lines; the Pro tiers and most preview models are paid-only. Rate limits sit in the range of a handful to a few dozen requests per minute and a few hundred to ~1,000 per day depending on model, and Google has adjusted these more than once, so check the current rate-limits page rather than trusting any blog number.

Three caveats for your case specifically:

    Training on your data is disqualifying the moment you have real users' receipts. Receipts carry card last-4 and merchant/location history. Fine for you testing with your own grocery runs; not fine once friends are uploading.
    Commercial use of the free tier has had regional restrictions, and the EU/EEA has been among them historically. You're in Bulgaria, so read the current Gemini API terms before assuming a free-tier-backed app is allowed, even a small one.
    No SLA. Free traffic gets deprioritized.

Alternatives if you'd rather not be on Google's free tier: OpenRouter exposes some free-weighted model endpoints, Groq and Mistral both run free developer tiers with vision-capable models, and self-hosting an open VLM (Qwen-VL family is the strongest at document/OCR work) costs nothing per call if you already have a GPU — though a receipt-quality open model at usable speed generally wants 16GB+ VRAM.

Practical path: prototype free on Gemini Flash-Lite with your own receipts, build the eval set while you're there, then flip to a paid Flash-Lite key the moment anyone else's data touches it. That switch is one line and costs you a few dollars a month.

Prices move fast in this space — verify against ai.google.dev/gemini-api/docs/pricing, platform.claude.com/docs/en/about-claude/pricing, and OpenAI's pricing page before you commit to unit economics.
