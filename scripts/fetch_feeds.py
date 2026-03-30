#!/usr/bin/env python3
"""
Azure News Feed - RSS Feed Fetcher
Fetches articles from Azure blog RSS feeds and generates a JSON data file.
Feed sources are configured in data/feeds-config.json.
"""

import feedparser
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from html import unescape


def load_feed_config():
    """Load feed configuration from data/feeds-config.json."""
    config_path = os.path.join("data", "feeds-config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def clean_html(text):
    """Remove HTML tags and clean up text."""
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    clean = unescape(clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def truncate(text, max_length=300):
    """Truncate text to max_length, ending at a word boundary."""
    if len(text) <= max_length:
        return text
    truncated = text[:max_length].rsplit(" ", 1)[0]
    return truncated + "..."


def parse_date(entry):
    """Parse date from feed entry, return ISO format string."""
    for field in ["published_parsed", "updated_parsed"]:
        parsed = entry.get(field)
        if parsed:
            try:
                dt = datetime(*parsed[:6], tzinfo=timezone.utc)
                return dt.isoformat()
            except (ValueError, TypeError):
                continue

    for field in ["published", "updated"]:
        date_str = entry.get(field, "")
        if date_str:
            return date_str

    return datetime.now(timezone.utc).isoformat()


def fetch_all_feeds(config):
    """Fetch articles from all configured feeds."""
    articles = []
    settings = config.get("settings", {})
    tc_pattern = settings.get(
        "techCommunityRssPattern",
        "https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id={board}",
    )
    delay = settings.get("fetchDelaySeconds", 0.5)
    max_length = settings.get("summaryMaxLength", 300)

    feeds = config.get("feeds", {})
    for blog_id, feed_info in feeds.items():
        blog_name = feed_info["name"]
        feed_url = feed_info.get("url")

        # If no explicit URL, it's a Tech Community feed
        if not feed_url:
            feed_url = tc_pattern.format(board=blog_id)

        print(f"Fetching: {blog_name} ({blog_id})...")

        try:
            feed = feedparser.parse(feed_url)

            if feed.bozo and not feed.entries:
                print(f"  Warning: Could not parse feed for {blog_name}")
                continue

            count = 0
            for entry in feed.entries:
                summary = clean_html(entry.get("summary", ""))
                articles.append(
                    {
                        "title": clean_html(entry.get("title", "Untitled")),
                        "link": entry.get("link", ""),
                        "published": parse_date(entry),
                        "summary": truncate(summary, max_length),
                        "blog": blog_name,
                        "blogId": blog_id,
                        "author": entry.get("author", "Microsoft"),
                    }
                )
                count += 1

            print(f"  Found {count} articles")

        except Exception as e:
            print(f"  Error fetching {blog_name}: {e}")

        time.sleep(delay)

    return articles


def generate_rss_feed(articles, max_items=50):
    """Generate an RSS feed XML file from the aggregated articles."""
    from xml.etree.ElementTree import Element, SubElement, tostring

    rss = Element("rss", version="2.0")
    rss.set("xmlns:dc", "http://purl.org/dc/elements/1.1/")
    channel = SubElement(rss, "channel")
    SubElement(channel, "title").text = "Azure News Feed"
    SubElement(channel, "link").text = "https://azurefeed.news"
    SubElement(channel, "description").text = (
        "Aggregated daily news from Azure blogs"
    )
    SubElement(channel, "lastBuildDate").text = datetime.now(
        timezone.utc
    ).strftime("%a, %d %b %Y %H:%M:%S GMT")
    SubElement(channel, "generator").text = "Azure News Feed"
    SubElement(channel, "language").text = "en"

    for article in articles[:max_items]:
        item = SubElement(channel, "item")
        SubElement(item, "title").text = article["title"]
        SubElement(item, "link").text = article["link"]
        SubElement(item, "guid").text = article["link"]
        SubElement(item, "description").text = article["summary"]
        SubElement(item, "dc:creator").text = article["author"]
        try:
            dt = datetime.fromisoformat(article["published"])
            SubElement(item, "pubDate").text = dt.strftime(
                "%a, %d %b %Y %H:%M:%S GMT"
            )
        except (ValueError, TypeError):
            pass
        SubElement(item, "category").text = article["blog"]

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(
        rss, encoding="unicode"
    )
    output_path = os.path.join("data", "feed.xml")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(xml_str)
    print(f"RSS feed saved to {output_path}")


def generate_ai_summary(articles):
    """Generate an AI summary of today's articles using OpenAI (optional)."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("No OPENAI_API_KEY set, skipping AI summary")
        return None

    try:
        import openai

        today = datetime.now(timezone.utc).date().isoformat()
        today_articles = [
            a for a in articles if a.get("published", "").startswith(today)
        ]

        if not today_articles:
            print("No articles published today, skipping AI summary")
            return None

        titles = "\n".join(
            ["- " + a["title"] + " (" + a["blog"] + ")" for a in today_articles[:20]]
        )
        prompt = (
            "You are a concise tech news editor. Summarize today's Azure blog posts "
            "in 2-3 sentences highlighting the most important themes and announcements. "
            "Be specific about technologies mentioned. Here are the articles:\n\n"
            + titles
        )

        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        summary = response.choices[0].message.content.strip()
        print(f"AI summary generated: {summary[:100]}...")
        return summary

    except Exception as e:
        print(f"AI summary failed: {e}")
        return None


def generate_article_insights(articles, config):
    """Generate per-article AI insights: one-liner + semantic tags."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("No OPENAI_API_KEY set, skipping article insights")
        return articles

    settings = config.get("settings", {})
    insights_config = settings.get("insights", {})
    if not insights_config.get("enabled", False):
        print("Article insights disabled in config")
        return articles

    try:
        import openai

        client = openai.OpenAI(api_key=api_key)
        model = insights_config.get("model", "gpt-4o-mini")
        batch_size = insights_config.get("batchSize", 10)
        valid_tags = insights_config.get("tags", [])
        tag_list = ", ".join(valid_tags)

        # Only process articles from the last 2 days to limit API costs
        cutoff = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        recent_indices = [
            i for i, a in enumerate(articles)
            if a.get("published", "") >= cutoff and "insight" not in a
        ]

        if not recent_indices:
            print("No recent articles need insights")
            return articles

        print(f"Generating insights for {len(recent_indices)} recent articles...")

        for batch_start in range(0, len(recent_indices), batch_size):
            batch_indices = recent_indices[batch_start:batch_start + batch_size]
            batch_articles = [articles[i] for i in batch_indices]

            article_list = "\n".join([
                f"{idx+1}. [{a['title']}] — {a['blog']}: {a['summary'][:150]}"
                for idx, a in enumerate(batch_articles)
            ])

            prompt = (
                "You are an Azure expert analyst. For each article below, provide:\n"
                "1. A one-line insight (what this means for practitioners, max 20 words)\n"
                f"2. Relevant tags from ONLY this set: [{tag_list}]\n\n"
                "Respond as JSON array. Each element: "
                '{"n": 1, "insight": "...", "tags": ["tag1"]}\n'
                "Only include tags that clearly apply. Most articles get 0-2 tags.\n\n"
                f"Articles:\n{article_list}"
            )

            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=1000,
                    response_format={"type": "json_object"},
                )
                raw = response.choices[0].message.content.strip()
                result = json.loads(raw)

                # Handle both {"items": [...]} and [...] formats
                items = result if isinstance(result, list) else result.get("items", result.get("articles", []))

                for item in items:
                    idx = item.get("n", 0) - 1
                    if 0 <= idx < len(batch_indices):
                        article_idx = batch_indices[idx]
                        insight = item.get("insight", "")
                        tags = [t for t in item.get("tags", []) if t in valid_tags]
                        articles[article_idx]["insight"] = insight
                        articles[article_idx]["tags"] = tags

                enriched = sum(1 for i in batch_indices if "insight" in articles[i])
                print(f"  Batch {batch_start//batch_size + 1}: enriched {enriched}/{len(batch_indices)} articles")

            except Exception as e:
                print(f"  Batch {batch_start//batch_size + 1} failed: {e}")

            time.sleep(1)  # Rate limit between batches

    except Exception as e:
        print(f"Article insights failed: {e}")

    return articles


def main():
    print("=" * 60)
    print("Azure News Feed - Fetching RSS Feeds")
    print("=" * 60)

    config = load_feed_config()
    settings = config.get("settings", {})

    all_articles = fetch_all_feeds(config)

    # Sort by date, newest first
    all_articles.sort(key=lambda x: x.get("published", ""), reverse=True)

    # Remove duplicates by link and discard articles older than retention window
    retention_days = settings.get("retentionDays", 30)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    seen_links = set()
    unique_articles = []
    for article in all_articles:
        if article["link"] and article["link"] not in seen_links:
            if article.get("published", "") >= cutoff:
                seen_links.add(article["link"])
                unique_articles.append(article)

    discarded = len(all_articles) - len(unique_articles)
    if discarded:
        print(f"Filtered out {discarded} duplicate/older-than-{retention_days}-days articles")

    # Generate AI summary (optional)
    summary = generate_ai_summary(unique_articles)

    # Generate per-article AI insights (optional)
    unique_articles = generate_article_insights(unique_articles, config)

    # Build categories from config for inclusion in output
    categories = {}
    for blog_id, feed_info in config.get("feeds", {}).items():
        cat = feed_info.get("category", "Uncategorized")
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(blog_id)

    data = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "totalArticles": len(unique_articles),
        "categories": categories,
        "articles": unique_articles,
    }
    if summary:
        data["summary"] = summary

    os.makedirs("data", exist_ok=True)
    output_path = os.path.join("data", "feeds.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Generate RSS feed
    max_rss = settings.get("maxRssItems", 50)
    generate_rss_feed(unique_articles, max_rss)

    print(f"\n{'=' * 60}")
    print(f"Done! {len(unique_articles)} unique articles saved to {output_path}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
