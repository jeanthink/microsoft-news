# 📰 Microsoft News

A daily-updated Microsoft blog aggregator hosted on GitHub Pages. Collects articles from 88+ Microsoft blogs and presents them in a clean, searchable interface — last 30 days only.

**Live site:** [jeanthink.github.io/microsoft-news](https://jeanthink.github.io/microsoft-news/)

## Features

- 📰 **88+ blog sources** — Azure, Microsoft 365, Security, Power Platform, Developer Tools, AI & more
- 🔍 **Search & filter** — By keyword, category, blog, product, solution area, revenue type
- 🏷️ **Solution areas** — Filter by AIBS, CAIP, or Security
- 💰 **Billing type** — Filter by PAYGO or License
- ⭐ **Bookmarks** — Save articles for later (stored locally)
- 📋 **Reading queue** — Mark articles as read, read later, or unseen
- 🌙 **Dark mode** — Easy on the eyes
- 📱 **Responsive** — Works on desktop, tablet, and mobile
- 🤖 **Auto-updated** — GitHub Actions fetches new articles daily at 12 PM UTC
- 📅 **Last 30 days** — Keeps only recent articles

## Setup

### 1. Enable GitHub Pages

Go to **Settings → Pages → Source** and select **Deploy from a branch** → **master** → **/ (root)**.

### 2. Trigger the first data fetch

Go to **Actions → Fetch Azure Blog Feeds → Run workflow** to populate the initial data.

### 3. Visit your site

Your feed will be live at `https://jeanthink.github.io/microsoft-news/`

## Local Development

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_feeds.py
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

## How It Works

1. **GitHub Actions** runs daily at 12 PM UTC (or manually)
2. **Python script** fetches RSS feeds from 88+ Microsoft blogs
3. Articles from the last 30 days are deduplicated, sorted, and saved to `data/feeds.json`
4. The commit triggers **GitHub Pages** to redeploy
5. The **static frontend** loads the JSON and renders the feed

## License

MIT
