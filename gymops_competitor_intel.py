"""
GymOps Competitor Intelligence Tool
====================================
Scrapes Google Play reviews for Hevy, Strong, and Fitbod,
then uses Claude API to extract pain points and opportunities.

Usage:
    pip install google-play-scraper anthropic
    python gymops_competitor_intel.py

Output:
    - competitor_reviews_raw.csv       Raw reviews from all apps
    - competitor_intel_report.md       Pain point analysis + GymOps opportunities
"""

import csv
import json
import time
import os
from datetime import datetime
from google_play_scraper import reviews, Sort
import anthropic

# ─── Config ──────────────────────────────────────────────────────────────────

APPS = [
    {"name": "Hevy",   "package_id": "com.hevy"},
    {"name": "Strong", "package_id": "io.strongapp.strong"},
    {"name": "Fitbod", "package_id": "com.fitbod.fitbod"},
]

REVIEWS_PER_APP = 300   # Pulls 150 low (1-3 star) + 150 high (4-5 star)
OUTPUT_DIR = "."        # Change to your preferred output directory

# ─── Step 1: Scrape Reviews ───────────────────────────────────────────────────

def scrape_reviews(package_id: str, app_name: str, count_per_band: int = 150) -> list[dict]:
    """Fetch low-rated and high-rated reviews for a single app."""
    all_reviews = []

    for score_filter, band_label in [(None, "mixed"), ]:
        # Fetch most relevant reviews (mix of ratings)
        try:
            result, _ = reviews(
                package_id,
                lang="en",
                country="us",
                sort=Sort.MOST_RELEVANT,
                count=count_per_band * 2,
                filter_score_with=None,
            )
            for r in result:
                all_reviews.append({
                    "app": app_name,
                    "score": r.get("score"),
                    "date": r.get("at", "").strftime("%Y-%m-%d") if r.get("at") else "",
                    "thumbs_up": r.get("thumbsUpCount", 0),
                    "content": r.get("content", "").replace("\n", " ").strip(),
                })
            print(f"  ✓ {app_name}: fetched {len(result)} reviews")
        except Exception as e:
            print(f"  ✗ {app_name} fetch error: {e}")

    # Separately pull 1-2 star reviews specifically for pain points
    for star in [1, 2]:
        try:
            result, _ = reviews(
                package_id,
                lang="en",
                country="us",
                sort=Sort.MOST_RELEVANT,
                count=75,
                filter_score_with=star,
            )
            for r in result:
                all_reviews.append({
                    "app": app_name,
                    "score": r.get("score"),
                    "date": r.get("at", "").strftime("%Y-%m-%d") if r.get("at") else "",
                    "thumbs_up": r.get("thumbsUpCount", 0),
                    "content": r.get("content", "").replace("\n", " ").strip(),
                })
            print(f"  ✓ {app_name}: fetched {len(result)} x {star}-star reviews")
            time.sleep(1)  # Be polite
        except Exception as e:
            print(f"  ✗ {app_name} {star}-star fetch error: {e}")

    return all_reviews


def save_raw_csv(all_reviews: list[dict], filepath: str):
    if not all_reviews:
        print("No reviews to save.")
        return
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["app", "score", "date", "thumbs_up", "content"])
        writer.writeheader()
        writer.writerows(all_reviews)
    print(f"\n✓ Raw reviews saved to {filepath}")


# ─── Step 2: Claude Analysis ──────────────────────────────────────────────────

ANALYSIS_SYSTEM_PROMPT = """You are a product strategist analysing competitor app reviews 
to find opportunities for a new fitness tracking app called GymOps.

GymOps vision: "A training log that assumes you already have a plan and refuses to get in 
your way while you execute it. Every session builds a personal strength dataset; 
the app is just the interface."

GymOps target user: Serious lifters who train with a coach or structured programme. 
They are intrinsically motivated — they don't need the app to motivate them, 
they need it to support their sense of mastery and progress. No gamification, no social layer.

You will receive batches of reviews for a competitor app. Extract:
1. Top 5 pain points (with example quotes paraphrased, not exact)
2. Top 3 things users love (to understand the bar GymOps must clear)
3. 2-3 specific GymOps opportunities based on these gaps

Be concrete. Reference specific friction points, not vague themes.
Respond in clean markdown."""

SYNTHESIS_PROMPT = """You have now analysed reviews from three competitor apps: Hevy, Strong, and Fitbod.

Here are the per-app analyses:

{per_app_analyses}

Now produce a CROSS-APP SYNTHESIS covering:
1. The universal pain points that all three apps share (these are market-wide gaps)
2. What the best apps do well that GymOps MUST match as table stakes
3. The 3 most compelling positioning opportunities for GymOps Phase 3
4. A one-paragraph positioning statement GymOps could use internally to guide Phase 3 decisions

Be direct and opinionated. This is a strategic brief, not a summary."""


def analyse_app_reviews(client: anthropic.Anthropic, app_name: str, reviews_list: list[dict]) -> str:
    """Send one app's reviews to Claude for analysis."""
    # Format reviews as a readable block — cap at 200 to manage tokens
    sample = sorted(reviews_list, key=lambda r: r.get("thumbs_up", 0), reverse=True)[:200]
    review_text = "\n".join(
        f"[{r['score']}★] {r['content']}"
        for r in sample
        if r.get("content")
    )

    print(f"  Analysing {app_name} ({len(sample)} reviews)...")

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        system=ANALYSIS_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Analyse these {app_name} Google Play reviews:\n\n{review_text}"
            }
        ]
    )
    return message.content[0].text


def synthesise_findings(client: anthropic.Anthropic, per_app_analyses: dict) -> str:
    """Cross-app synthesis — the strategic brief."""
    combined = "\n\n---\n\n".join(
        f"## {app}\n\n{analysis}"
        for app, analysis in per_app_analyses.items()
    )

    print("  Running cross-app synthesis...")

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[
            {
                "role": "user",
                "content": SYNTHESIS_PROMPT.format(per_app_analyses=combined)
            }
        ]
    )
    return message.content[0].text


def save_report(per_app_analyses: dict, synthesis: str, filepath: str):
    """Write the full markdown report."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# GymOps Competitor Intelligence Report",
        f"*Generated: {timestamp}*\n",
        "---\n",
        "## Per-App Analyses\n",
    ]
    for app_name, analysis in per_app_analyses.items():
        lines.append(f"### {app_name}\n")
        lines.append(analysis)
        lines.append("\n---\n")

    lines.append("## Cross-App Synthesis & GymOps Opportunities\n")
    lines.append(synthesis)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"✓ Report saved to {filepath}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("GymOps Competitor Intelligence Tool")
    print("=" * 60)

    # Validate Anthropic API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n⚠️  ANTHROPIC_API_KEY environment variable not set.")
        print("    Export it before running: export ANTHROPIC_API_KEY=sk-ant-...")
        return

    client = anthropic.Anthropic(api_key=api_key)

    # ── Scrape ──────────────────────────────────────────────────────────────
    print("\n[1/3] Scraping Google Play reviews...\n")
    all_reviews = []

    for app_config in APPS:
        print(f"Fetching {app_config['name']}...")
        app_reviews = scrape_reviews(app_config["package_id"], app_config["name"])
        all_reviews.extend(app_reviews)
        time.sleep(2)  # Pause between apps

    raw_csv_path = os.path.join(OUTPUT_DIR, "competitor_reviews_raw.csv")
    save_raw_csv(all_reviews, raw_csv_path)

    if not all_reviews:
        print("\n⚠️  No reviews fetched. Check your internet connection and try again.")
        return

    # ── Analyse ─────────────────────────────────────────────────────────────
    print("\n[2/3] Analysing reviews with Claude...\n")
    per_app_analyses = {}

    for app_config in APPS:
        app_name = app_config["name"]
        app_reviews = [r for r in all_reviews if r["app"] == app_name]

        if not app_reviews:
            print(f"  Skipping {app_name} — no reviews fetched.")
            continue

        analysis = analyse_app_reviews(client, app_name, app_reviews)
        per_app_analyses[app_name] = analysis
        time.sleep(1)

    # ── Synthesise ──────────────────────────────────────────────────────────
    print("\n[3/3] Generating strategic synthesis...\n")
    synthesis = synthesise_findings(client, per_app_analyses)

    # ── Save Report ─────────────────────────────────────────────────────────
    report_path = os.path.join(OUTPUT_DIR, "competitor_intel_report.md")
    save_report(per_app_analyses, synthesis, report_path)

    print("\n" + "=" * 60)
    print("Done.")
    print(f"  Raw data: {raw_csv_path}")
    print(f"  Report:   {report_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()