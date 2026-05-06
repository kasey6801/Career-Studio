import asyncio
import json
import os
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel, Field, field_validator

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PUBLIC_DIR = BASE_DIR / "public"

app = FastAPI(title="Career Positioning Studio")

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SHARED_RULES = """RULES — applied to every output:
1. NEVER invent employers, certifications, degrees, dates, metrics, or tools that are not in the source. If something is required by the output but missing from the source, write "[FILL: <description>]".
2. Use ATS-safe phrasing. Spell out acronyms once, then reuse the acronym.
3. Output must be valid Markdown. No HTML, no images.
4. Be concise and specific. Avoid generic resume filler.
5. If the candidate has a clear differentiator (single-employer tenure, regional rotations, specialty domain), foreground it.
6. Where you make a recommendation, briefly say why.
"""


def _linkedin_prompt(ctx: str) -> str:
    return f"""{SHARED_RULES}

You are an expert LinkedIn profile strategist. Based on the candidate's career data below, produce a comprehensive LinkedIn Update Plan.

Required output structure — use these exact headings:

# LinkedIn Update Plan

## New Headline (2 options)
Provide exactly 2 headline options, each under 220 characters. Format as:
- Option 1: [headline] — [one sentence on why this framing works]
- Option 2: [headline] — [one sentence on why this framing works]

## New About Section
Write a complete About section (300–400 words). First-person voice. Lead with the candidate's strongest differentiator. End with a clear call to action.

## Experience Section — Rewrite Prompts
For each role in the source, provide 3–4 rewritten achievement bullets. Use the format:
**[Job Title at Company Name]**
- [bullet starting with strong action verb — quantified where metrics exist in the source]

## Skills Section — Top 10 to Pin
Numbered list of exactly 10 skills to pin. For each: skill name + one-sentence rationale.

## Featured / Highlighted Content Suggestions
3–5 concrete Featured section ideas (articles, projects, media). Use [FILL: …] for items requiring candidate input.

## Profile Hygiene Checklist
- [ ] [checklist item]
(Include: photo, banner, custom URL, contact info, open-to-work setting, connection count strategy, recommendations)

---
Candidate data:
{ctx}"""


def _cv_prompt(ctx: str) -> str:
    return f"""{SHARED_RULES}

Additional CV rules:
- Reverse-chronological order for all experience.
- Do NOT use tables for layout — use dash-bullet lists only.
- Date format: Mon YYYY – Mon YYYY (e.g., Jan 2020 – Mar 2023). Use "Present" for current roles.
- NEVER invent certifications, degrees, or employers. Use [FILL: …] for required missing fields.
- Each bullet: one line, strong action verb, quantified where metrics exist in the source.

You are an expert ATS-optimised CV writer. Produce a complete master CV from the candidate data below.

Required output structure — use this exact format:

# [Candidate Full Name]
**[One-line professional tagline — 10–15 words]**

[City, Country] · [email] · [LinkedIn URL] · [GitHub or portfolio URL if present]

---

## Professional Summary
3–4 sentences. Lead with years of experience and domain. Include top 2–3 differentiators. End with career direction.

## Core Competencies
8–12 competencies as a comma-separated inline list.

## Technical Skills
Grouped by category. One line per group: **Category:** item1, item2, item3

## Professional Experience

### [Job Title]
**[Company Name]** · [City, Country] · [Mon YYYY – Mon YYYY]
- [achievement bullet]

## Certifications
- [Cert name] — [Issuer], [Year]

## Education

### [Degree]
**[Institution]** · [City, Country] · [Year]

## Languages
- [Language]: [Proficiency level]

---
Candidate data:
{ctx}"""


def _dev_prompt(ctx: str) -> str:
    return f"""{SHARED_RULES}

Additional rules:
- Do NOT invent URLs, course links, or certification exam codes. Use only well-known cert names without fabricating links.
- If the candidate has not specified a target role, infer the most likely next step from the profile.

You are an expert career development coach. Produce a 6–12 month professional development plan.

Required output structure — use these exact headings:

# Professional Development Plan — 6–12 months

## Plan Logic
2–3 sentences on the strategic rationale given the candidate's current position and goals.

## Certification Roadmap
| Tier | Cert | Issuer | Why | Est. Cost | Est. Hours |
|------|------|--------|-----|-----------|------------|
(Tier 1 = 0–3 months, Tier 2 = 3–6 months, Tier 3 = 6–12 months. Include 4–6 rows.)

## Hands-on Projects (3–4)

### Project 1: [Title]
[Description, technologies, expected portfolio artefact]

## Networking & Portfolio Milestones
- [ ] [milestone] | Month [N]

## Curated Learning Resources
**[Topic]:** [Resource name] ([platform]) — one sentence on why it fits.
(3–5 entries. No invented URLs.)

## Open Items Requiring Candidate Input
- [ ] [information the candidate must provide to refine this plan]

---
Candidate data:
{ctx}"""


def _jobs_prompt(ctx: str) -> str:
    return f"""{SHARED_RULES}

You are an expert job search strategist. Produce a targeted job search plan from the candidate data below.

Required output structure — use these exact headings:

# 10 Target Roles to Pursue

## Search Strategy
3 sentences on the overall search strategy: geography, channels, and positioning angle.

(Then, for each of the 10 roles, use this exact format:)

### 1. [Job Title]
- **Likely employers:** [3–5 example employer types or named organisations]
- **Why this fits:** [2 sentences connecting candidate background to role requirements]
- **Fit score:** [X/10] — [one sentence justification]
- **Gaps to close:** [2–3 specific gaps, or "None identified"]
- **LinkedIn search query:** `[paste-ready query]`
- **Indeed search query:** `[paste-ready query]`

(Repeat for roles 2–10.)

## Outreach Targets (5 people-types)
For each: type of person + one-sentence outreach angle on LinkedIn.

## Weekly Application Cadence
| Day | Task | Time (min) |
|-----|------|------------|
(Mon–Fri. Specific daily tasks: applications, outreach, learning, networking.)

---
Candidate data:
{ctx}"""


PROMPT_BUILDERS = {
    "linkedin": _linkedin_prompt,
    "cv": _cv_prompt,
    "dev": _dev_prompt,
    "jobs": _jobs_prompt,
}


def build_context(data: "GenerateRequest") -> str:
    parts = [f"=== LinkedIn Profile ===\n{data.linkedin}"]
    if data.website:
        parts.append(f"=== Personal Website / Portfolio URL ===\n{data.website}")
    if data.github:
        parts.append(f"=== GitHub URL ===\n{data.github}")
    if data.cv:
        parts.append(f"=== Existing CV / Resume ===\n{data.cv}")
    if data.q1:
        parts.append(f"=== Career Goal — Target Titles ===\n{data.q1}")
    if data.q2:
        parts.append(f"=== Career Goal — Target Industries ===\n{data.q2}")
    if data.q3:
        parts.append(f"=== Career Goal — Geography / Timeline / Constraints ===\n{data.q3}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Request model — strict validation with length caps
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=512)
    base_url: str = Field(..., min_length=1, max_length=256)
    model: str = Field(..., min_length=1, max_length=128)
    linkedin: str = Field(..., min_length=1, max_length=30_720)   # 30 KB
    website: str = Field(default="", max_length=512)
    github: str = Field(default="", max_length=512)
    cv: str = Field(default="", max_length=30_720)                # 30 KB
    q1: str = Field(default="", max_length=2_048)
    q2: str = Field(default="", max_length=2_048)
    q3: str = Field(default="", max_length=2_048)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("base_url must start with http:// or https://")
        return v.rstrip("/")

    @field_validator("linkedin")
    @classmethod
    def validate_linkedin(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("LinkedIn profile content is required")
        return v


# ---------------------------------------------------------------------------
# Streaming helpers
# ---------------------------------------------------------------------------

async def stream_section(
    client: AsyncOpenAI,
    model: str,
    prompt: str,
    section: str,
    queue: asyncio.Queue,
) -> None:
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            timeout=120.0,
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                await queue.put({"section": section, "chunk": chunk.choices[0].delta.content})
        await queue.put({"section": section, "done": True})
    except Exception as exc:
        await queue.put({"section": section, "error": str(exc)})


async def _sse_generator(request: GenerateRequest) -> AsyncGenerator[str, None]:
    extra_headers: dict = {}
    if "api.anthropic.com" in request.base_url:
        extra_headers["anthropic-version"] = "2023-06-01"

    client = AsyncOpenAI(
        api_key=request.api_key,
        base_url=request.base_url,
        default_headers=extra_headers,
    )

    ctx = build_context(request)
    queue: asyncio.Queue = asyncio.Queue()

    async def run_all() -> None:
        tasks = [
            asyncio.create_task(
                stream_section(client, request.model, PROMPT_BUILDERS[s](ctx), s, queue)
            )
            for s in ("linkedin", "cv", "dev", "jobs")
        ]
        await asyncio.gather(*tasks)
        await queue.put(None)  # sentinel

    asyncio.create_task(run_all())

    while True:
        item = await queue.get()
        if item is None:
            yield f"data: {json.dumps({'done': True})}\n\n"
            break
        yield f"data: {json.dumps(item)}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/api/generate")
async def generate(request: GenerateRequest):
    return StreamingResponse(
        _sse_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/job-sources")
async def job_sources():
    path = DATA_DIR / "job-sources.json"
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.get("/api/sample")
async def sample():
    path = DATA_DIR / "sample-profile.txt"
    return JSONResponse({"content": path.read_text(encoding="utf-8")})


# Serve frontend — mount last so API routes take priority
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")
