(function () {
  "use strict";

  // ===== Category Mapping (loaded from feed data) =====
  var CATEGORIES = {};
  var SOLUTION_AREAS = {};
  var REVENUE_TYPES = {};
  var currentTagFilter = "all";
  var currentSolutionArea = "all";
  var currentRevenueType = "all";
  var currentBlogSource = "all";

  // ===== State =====
  var articles = [];
  var filteredArticles = [];
  var currentCategory = "all";
  var currentFilter = "all";
  var searchQuery = "";
  var sortBy = "date-desc";
  var bookmarks = new Set(
    JSON.parse(localStorage.getItem("azurefeed-bookmarks") || "[]")
  );
  var showBookmarksOnly = false;

  // Reading state: tracks article status — "read", "read-later", or absent (unseen)
  var readingState = JSON.parse(localStorage.getItem("azurefeed-reading") || "{}");
  var readingFilter = "all"; // "all", "unseen", "read-later", "read"

  // Color palette for blog tags
  var blogColors = {};
  var colorPalette = [
    "#0078D4", "#00BCF2", "#7719AA", "#E3008C", "#D83B01",
    "#107C10", "#008575", "#4F6BED", "#B4009E", "#C239B3",
    "#E81123", "#FF8C00", "#00B294", "#68217A", "#0063B1",
    "#2D7D9A", "#5C2D91", "#CA5010", "#038387", "#8764B8",
    "#567C73", "#C30052", "#6B69D6", "#8E8CD8", "#00B7C3",
    "#EE5E00", "#847545", "#5D5A58", "#767676", "#4C4A48",
    "#0099BC",
  ];

  // ===== DOM Elements =====
  var articlesGrid = document.getElementById("articles-grid");
  var loadingEl = document.getElementById("loading");
  var noResultsEl = document.getElementById("no-results");
  var searchInput = document.getElementById("search-input");
  var sortSelect = document.getElementById("sort-by");
  var dateFilter = document.getElementById("date-filter");
  var themeToggle = document.getElementById("theme-toggle");
  var filterPills = document.getElementById("filter-pills");
  var showingCount = document.getElementById("showing-count");
  var lastUpdated = document.getElementById("last-updated");
  var totalCount = document.getElementById("total-count");
  var toastEl = document.getElementById("toast");
  var bookmarksToggle = document.getElementById("bookmarks-toggle");
  var aiSummaryEl = document.getElementById("ai-summary");
  var catchupBannerEl = document.getElementById("catchup-banner");

  // ===== Initialize =====
  async function init() {
    loadTheme();
    registerServiceWorker();
    await loadData();
    setupEventListeners();
  }

  // ===== Service Worker =====
  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  // ===== Load Data =====
  async function loadData() {
    showLoading(true);
    try {
      var response = await fetch("data/feeds.json");
      if (!response.ok) throw new Error("Failed to load feeds");
      var data = await response.json();
      articles = data.articles || [];

      // Load categories from feed data (generated from feeds-config.json)
      if (data.categories) {
        CATEGORIES = data.categories;
      }
      if (data.solutionAreas) {
        SOLUTION_AREAS = data.solutionAreas;
      }
      if (data.revenueTypes) {
        REVENUE_TYPES = data.revenueTypes;
      }

      // Assign colors to blogs
      var blogs = [];
      var seen = {};
      articles.forEach(function (a) {
        if (!seen[a.blogId]) {
          seen[a.blogId] = true;
          blogs.push({ id: a.blogId, name: a.blog });
        }
      });
      blogs.forEach(function (b, i) {
        blogColors[b.id] = colorPalette[i % colorPalette.length];
      });

      // Populate blog source filter dropdown
      var blogSourceEl = document.getElementById("blog-source-filter");
      if (blogSourceEl) {
        var sorted = blogs.slice().sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        sorted.forEach(function (b) {
          var opt = document.createElement("option");
          opt.value = b.id;
          opt.textContent = b.name;
          blogSourceEl.appendChild(opt);
        });
      }

      // Update header stats
      if (data.lastUpdated) {
        var date = new Date(data.lastUpdated);
        lastUpdated.textContent =
          "Last updated: " +
          date.toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
      }
      totalCount.textContent = articles.length + " articles";

      // Render AI summary if available
      if (data.summary) {
        aiSummaryEl.innerHTML =
          "<h2>🤖 Today's Highlights</h2>" +
          "<p>" + escapeHtml(data.summary) + "</p>";
        aiSummaryEl.style.display = "block";
      }

      // Show catch-up banner if user has been away
      showCatchupBanner();

      renderFilters();
      renderTagFilters();
      applyFilters();
    } catch (err) {
      console.error("Error loading feeds:", err);
      articlesGrid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;color:var(--text-secondary);">' +
        '<p style="font-size:1.3rem;margin-bottom:0.5rem;">📡 No feed data available yet</p>' +
        "<p>Run the GitHub Action to fetch the latest articles, or check back later.</p>" +
        "</div>";
    }
    showLoading(false);
  }

  // ===== Render Filter Pills (with category grouping) =====
  function renderFilters() {
    var blogCounts = {};
    articles.forEach(function (a) {
      if (!blogCounts[a.blogId]) {
        blogCounts[a.blogId] = { name: a.blog, count: 0 };
      }
      blogCounts[a.blogId].count++;
    });

    // Category bar
    var catHtml =
      '<div class="category-bar" id="category-bar">' +
      '<button class="category-pill active" data-category="all">All <span class="count">' +
      articles.length + "</span></button>";

    Object.keys(CATEGORIES).forEach(function (catName) {
      var catBlogs = CATEGORIES[catName];
      var catCount = 0;
      catBlogs.forEach(function (blogId) {
        if (blogCounts[blogId]) catCount += blogCounts[blogId].count;
      });
      if (catCount > 0) {
        catHtml +=
          '<button class="category-pill" data-category="' + catName + '">' +
          catName + ' <span class="count">' + catCount + "</span></button>";
      }
    });
    catHtml += "</div>";

    // Blog pills (shown below categories)
    var blogHtml = '<div class="blog-pills-row" id="blog-pills-row" style="display:none;">';
    blogHtml += '<div class="filter-pills" id="blog-filter-pills"></div></div>';

    filterPills.innerHTML = catHtml + blogHtml;
  }

  // Render blog pills for a specific category
  function renderBlogPills(categoryName) {
    var blogPillsRow = document.getElementById("blog-pills-row");
    var blogFilterPills = document.getElementById("blog-filter-pills");
    if (!blogFilterPills) return;

    if (categoryName === "all") {
      blogPillsRow.style.display = "none";
      return;
    }

    var blogCounts = {};
    articles.forEach(function (a) {
      if (!blogCounts[a.blogId]) {
        blogCounts[a.blogId] = { name: a.blog, count: 0 };
      }
      blogCounts[a.blogId].count++;
    });

    var catBlogs = CATEGORIES[categoryName] || [];
    var html = '<button class="pill active" data-filter="all">All in ' +
      escapeHtml(categoryName) + "</button>";
    catBlogs.forEach(function (blogId) {
      if (blogCounts[blogId]) {
        html +=
          '<button class="pill" data-filter="' + blogId + '">' +
          escapeHtml(blogCounts[blogId].name) +
          ' <span class="count">' + blogCounts[blogId].count + "</span></button>";
      }
    });

    blogFilterPills.innerHTML = html;
    blogPillsRow.style.display = "block";
  }

  // ===== Catch-up Banner =====
  function showCatchupBanner() {
    var lastVisit = localStorage.getItem("azurefeed-last-visit");
    var now = new Date();

    // Update last visit time
    localStorage.setItem("azurefeed-last-visit", now.toISOString());

    if (!lastVisit || !catchupBannerEl) return;

    var lastDate = new Date(lastVisit);
    var hoursAway = Math.floor((now - lastDate) / (1000 * 60 * 60));

    // Only show if away for more than 18 hours
    if (hoursAway < 18) return;

    var daysAway = Math.floor(hoursAway / 24);
    var missedArticles = articles.filter(function (a) {
      return new Date(a.published) > lastDate;
    });

    if (missedArticles.length === 0) return;

    // Count articles by category
    var catCounts = {};
    missedArticles.forEach(function (a) {
      Object.keys(CATEGORIES).forEach(function (cat) {
        if (CATEGORIES[cat].indexOf(a.blogId) !== -1) {
          catCounts[cat] = (catCounts[cat] || 0) + 1;
        }
      });
    });

    // Count tagged articles
    var tagCounts = {};
    missedArticles.forEach(function (a) {
      if (a.tags) {
        a.tags.forEach(function (tag) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    // Build banner
    var timeLabel = daysAway >= 1 ? daysAway + " day" + (daysAway > 1 ? "s" : "") : hoursAway + " hours";
    var html = "<h2>👋 Welcome back! You've been away " + timeLabel + "</h2>";
    html += "<p><strong>" + missedArticles.length + " new articles</strong> since your last visit.</p>";

    // Show top categories
    var sortedCats = Object.keys(catCounts).sort(function (a, b) {
      return catCounts[b] - catCounts[a];
    });
    if (sortedCats.length > 0) {
      html += '<div class="catchup-stats">';
      sortedCats.slice(0, 5).forEach(function (cat) {
        html += '<span class="catchup-stat"><strong>' + catCounts[cat] + '</strong> ' + escapeHtml(cat) + '</span>';
      });
      html += '</div>';
    }

    // Highlight important tags
    var importantTags = ["breaking-change", "ga-release", "deprecation", "security"];
    var alerts = [];
    importantTags.forEach(function (tag) {
      if (tagCounts[tag]) {
        var emoji = tag === "breaking-change" ? "⚠️" : tag === "ga-release" ? "🚀" :
          tag === "deprecation" ? "📦" : "🔒";
        alerts.push(emoji + " " + tagCounts[tag] + " " + tag.replace(/-/g, " "));
      }
    });
    if (alerts.length > 0) {
      html += "<p>" + alerts.join(" &bull; ") + "</p>";
    }

    html += '<button class="catchup-dismiss" id="catchup-dismiss">✓ Got it</button>';
    catchupBannerEl.innerHTML = html;
    catchupBannerEl.style.display = "block";

    // Dismiss handler
    setTimeout(function () {
      var dismissBtn = document.getElementById("catchup-dismiss");
      if (dismissBtn) {
        dismissBtn.addEventListener("click", function () {
          catchupBannerEl.style.display = "none";
        });
      }
    }, 0);
  }

  // ===== Tag Filters =====
  function renderTagFilters() {
    var tagCounts = {};
    articles.forEach(function (a) {
      if (a.tags) {
        a.tags.forEach(function (tag) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    var tags = Object.keys(tagCounts).sort(function (a, b) {
      return tagCounts[b] - tagCounts[a];
    });

    if (tags.length === 0) return;

    var tagRow = document.createElement("div");
    tagRow.className = "tag-filters";
    tagRow.id = "tag-filters";

    var html = '<button class="tag-pill active" data-tag="all">All Tags</button>';
    tags.forEach(function (tag) {
      html +=
        '<button class="tag-pill" data-tag="' + escapeHtml(tag) + '">' +
        escapeHtml(tag.replace(/-/g, " ")) +
        ' <span class="count">' + tagCounts[tag] + "</span></button>";
    });
    tagRow.innerHTML = html;

    // Insert after filter-pills
    var filtersEl = document.querySelector(".filters .filter-scroll");
    if (filtersEl) {
      filtersEl.appendChild(tagRow);
    }

    // Event delegation for tag pills
    tagRow.addEventListener("click", function (e) {
      var pill = e.target.closest(".tag-pill");
      if (!pill) return;
      tagRow.querySelectorAll(".tag-pill").forEach(function (p) {
        p.classList.remove("active");
      });
      pill.classList.add("active");
      currentTagFilter = pill.dataset.tag;
      applyFilters();
    });
  }

  // ===== Apply Filters & Sort =====
  function applyFilters() {
    var result = articles.slice();

    // Category filter
    if (currentCategory !== "all") {
      var catBlogs = CATEGORIES[currentCategory] || [];
      result = result.filter(function (a) {
        return catBlogs.indexOf(a.blogId) !== -1;
      });
    }

    // Solution area filter
    if (currentSolutionArea !== "all") {
      var saBlogs = SOLUTION_AREAS[currentSolutionArea] || [];
      result = result.filter(function (a) {
        return saBlogs.indexOf(a.blogId) !== -1;
      });
    }

    // Revenue type filter
    if (currentRevenueType !== "all") {
      var rtBlogs = REVENUE_TYPES[currentRevenueType] || [];
      result = result.filter(function (a) {
        return rtBlogs.indexOf(a.blogId) !== -1;
      });
    }

    // Blog source filter
    if (currentBlogSource !== "all") {
      result = result.filter(function (a) {
        return a.blogId === currentBlogSource;
      });
    }

    // Blog filter (within category)
    if (currentFilter !== "all") {
      result = result.filter(function (a) { return a.blogId === currentFilter; });
    }

    // Search filter
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      result = result.filter(function (a) {
        return (
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.blog.toLowerCase().includes(q) ||
          a.author.toLowerCase().includes(q)
        );
      });
    }

    // Date filter
    var dateVal = dateFilter ? dateFilter.value : "all";
    if (dateVal !== "all") {
      var now = new Date();
      var cutoff = new Date();
      switch (dateVal) {
        case "today": cutoff.setHours(0, 0, 0, 0); break;
        case "week": cutoff.setDate(now.getDate() - 7); break;
        case "month": cutoff.setMonth(now.getMonth() - 1); break;
      }
      result = result.filter(function (a) { return new Date(a.published) >= cutoff; });
    }

    // Bookmarks filter
    if (showBookmarksOnly) {
      result = result.filter(function (a) { return bookmarks.has(a.link); });
    }

    // Tag filter
    if (currentTagFilter !== "all") {
      result = result.filter(function (a) {
        return a.tags && a.tags.indexOf(currentTagFilter) !== -1;
      });
    }

    // Reading status filter
    if (readingFilter !== "all") {
      result = result.filter(function (a) {
        return getReadingStatus(a.link) === readingFilter;
      });
    }

    // Sort
    switch (sortBy) {
      case "date-desc":
        result.sort(function (a, b) { return new Date(b.published) - new Date(a.published); });
        break;
      case "date-asc":
        result.sort(function (a, b) { return new Date(a.published) - new Date(b.published); });
        break;
      case "blog":
        result.sort(function (a, b) {
          return a.blog.localeCompare(b.blog) || new Date(b.published) - new Date(a.published);
        });
        break;
    }

    filteredArticles = result;

    // Update counts with reading stats
    var stats = getReadingStats();
    var countText = "Showing " + result.length + " of " + articles.length;
    if (stats.read > 0 || stats.later > 0) {
      countText += " · ✅ " + stats.read + " read · 📋 " + stats.later + " queued";
    }
    showingCount.textContent = countText;
    renderArticles();
  }

  // ===== Render Articles =====
  function renderArticles() {
    if (filteredArticles.length === 0) {
      articlesGrid.innerHTML = "";
      noResultsEl.classList.add("visible");
      return;
    }
    noResultsEl.classList.remove("visible");

    var groups = groupByDate(filteredArticles);
    var html = "";
    for (var groupName in groups) {
      if (!groups.hasOwnProperty(groupName)) continue;
      html +=
        '<div class="date-group-header">📅 ' +
        escapeHtml(groupName) +
        "</div>";
      groups[groupName].forEach(function (article) {
        html += renderCard(article);
      });
    }

    articlesGrid.innerHTML = html;
  }

  // ===== Group by Date =====
  function groupByDate(list) {
    var groups = {};
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    var weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    var orderedKeys = [];

    list.forEach(function (article) {
      var date = new Date(article.published);
      var group;
      if (date >= today) {
        group = "Today";
      } else if (date >= yesterday) {
        group = "Yesterday";
      } else if (date >= weekAgo) {
        group = "This Week";
      } else {
        group = date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        });
      }
      if (!groups[group]) {
        groups[group] = [];
        orderedKeys.push(group);
      }
      groups[group].push(article);
    });

    var ordered = {};
    orderedKeys.forEach(function (key) {
      ordered[key] = groups[key];
    });
    return ordered;
  }

  // ===== Check if article is new (last 24h) =====
  function isNew(article) {
    var now = new Date();
    var published = new Date(article.published);
    return (now - published) < 24 * 60 * 60 * 1000;
  }

  // ===== Render Single Card =====
  function renderCard(article) {
    var color = blogColors[article.blogId] || "#0078D4";
    var isBookmarked = bookmarks.has(article.link);
    var date = new Date(article.published);
    var dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    var encodedLink = encodeURIComponent(article.link);
    var newBadge = isNew(article) ? '<span class="new-badge">NEW</span>' : "";

    var shareUrl = encodeURIComponent(article.link);
    var shareTitle = encodeURIComponent(article.title);

    // Reading status
    var status = getReadingStatus(article.link);
    var statusIcon = status === "read" ? "✅" : status === "read-later" ? "📋" : "○";
    var statusTitle = status === "read" ? "Read — click to clear" :
      status === "read-later" ? "Read later — click to mark read" : "Click to mark read later";
    var cardClass = "article-card" + (status === "read" ? " article-read" : "") +
      (status === "read-later" ? " article-read-later" : "");

    // Build tags HTML
    var tagsHtml = "";
    if (article.tags && article.tags.length > 0) {
      tagsHtml = '<div class="article-tags">';
      article.tags.forEach(function (tag) {
        tagsHtml += '<span class="article-tag article-tag--' + escapeHtml(tag) + '">' +
          escapeHtml(tag.replace(/-/g, " ")) + "</span>";
      });
      tagsHtml += "</div>";
    }

    // Build insight HTML
    var insightHtml = "";
    if (article.insight) {
      insightHtml = '<div class="article-insight">💡 ' + escapeHtml(article.insight) + "</div>";
    }

    // Build solution area / revenue badges
    var metaBadges = "";
    if (article.solutionArea) {
      var saIcons = { AIBS: "🧠", CAIP: "☁️", Security: "🔒" };
      metaBadges += '<span class="sa-badge sa-badge--' + escapeHtml(article.solutionArea) + '">' +
        (saIcons[article.solutionArea] || "") + " " + escapeHtml(article.solutionArea) + "</span>";
    }
    if (article.revenueType) {
      var rtIcons = { ACR: "📊", License: "📄" };
      metaBadges += '<span class="rt-badge rt-badge--' + escapeHtml(article.revenueType) + '">' +
        (rtIcons[article.revenueType] || "") + " " + escapeHtml(article.revenueType) + "</span>";
    }

    return (
      '<article class="' + cardClass + '">' +
      '<div class="card-header">' +
      '<span class="blog-tag" style="background:' + color + "18;color:" + color + ';">' +
      escapeHtml(article.blog) + "</span>" +
      (metaBadges ? '<span class="meta-badges">' + metaBadges + "</span>" : "") +
      '<div class="card-actions-top">' +
      '<button class="reading-btn ' + status +
      '" data-action="reading" data-link="' + encodedLink +
      '" title="' + statusTitle + '">' + statusIcon + "</button>" +
      '<button class="bookmark-btn ' + (isBookmarked ? "bookmarked" : "") +
      '" data-action="bookmark" data-link="' + encodedLink +
      '" title="' + (isBookmarked ? "Remove bookmark" : "Bookmark this article") + '">' +
      (isBookmarked ? "⭐" : "☆") + "</button>" +
      "</div></div>" +
      '<h3 class="article-title">' +
      '<a href="' + escapeHtml(article.link) + '" target="_blank" rel="noopener" data-trackread="' + encodedLink + '">' +
      escapeHtml(article.title) + "</a>" + newBadge +
      "</h3>" +
      tagsHtml +
      insightHtml +
      '<div class="article-meta">' +
      "<span>✍️ " + escapeHtml(article.author) + "</span>" +
      "<span>📅 " + dateStr + "</span>" +
      "</div>" +
      '<p class="article-summary">' + escapeHtml(article.summary) + "</p>" +
      '<div class="share-buttons">' +
      "</div>" +
      "</article>"
    );
  }

  // ===== Toggle Bookmark =====
  function toggleBookmark(link) {
    if (bookmarks.has(link)) {
      bookmarks.delete(link);
      showToast("Bookmark removed");
    } else {
      bookmarks.add(link);
      showToast("⭐ Article bookmarked!");
    }
    localStorage.setItem(
      "azurefeed-bookmarks",
      JSON.stringify(Array.from(bookmarks))
    );
    applyFilters();
  }

  // ===== Reading State Management =====
  function getReadingStatus(link) {
    return readingState[link] || "unseen";
  }

  function setReadingStatus(link, status) {
    if (status === "unseen") {
      delete readingState[link];
    } else {
      readingState[link] = status;
    }
    // Prune entries older than retention window (keep state manageable)
    var keys = Object.keys(readingState);
    if (keys.length > 2000) {
      var sorted = keys.sort();
      var toRemove = sorted.slice(0, keys.length - 1500);
      toRemove.forEach(function (k) { delete readingState[k]; });
    }
    localStorage.setItem("azurefeed-reading", JSON.stringify(readingState));
  }

  function cycleReadingStatus(link) {
    var current = getReadingStatus(link);
    var next;
    if (current === "unseen") {
      next = "read-later";
      showToast("📋 Marked as read later");
    } else if (current === "read-later") {
      next = "read";
      showToast("✅ Marked as read");
    } else {
      next = "unseen";
      showToast("Cleared reading status");
    }
    setReadingStatus(link, next);
    applyFilters();
  }

  function markAsRead(link) {
    setReadingStatus(link, "read");
  }

  function getReadingStats() {
    var total = articles.length;
    var readCount = 0;
    var laterCount = 0;
    articles.forEach(function (a) {
      var s = getReadingStatus(a.link);
      if (s === "read") readCount++;
      else if (s === "read-later") laterCount++;
    });
    return { total: total, read: readCount, later: laterCount, unseen: total - readCount - laterCount };
  }

  // ===== Find article by encoded link =====
  function findArticleByEncodedLink(encodedLink) {
    var link = decodeURIComponent(encodedLink);
    return articles.find(function (a) {
      return a.link === link;
    });
  }

  // ===== Toast =====
  var toastTimeout;
  function showToast(message) {
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    toastTimeout = setTimeout(function () {
      toastEl.classList.remove("visible");
    }, 3000);
  }

  // ===== Loading =====
  function showLoading(show) {
    loadingEl.classList.toggle("visible", show);
  }

  // ===== Theme =====
  function loadTheme() {
    var saved = localStorage.getItem("azurefeed-theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
    themeToggle.textContent = saved === "dark" ? "☀️" : "🌙";
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("azurefeed-theme", next);
    themeToggle.textContent = next === "dark" ? "☀️" : "🌙";
  }

  // ===== Escape Helpers =====
  var escapeDiv = document.createElement("div");
  function escapeHtml(str) {
    if (!str) return "";
    escapeDiv.textContent = str;
    return escapeDiv.innerHTML;
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    // Search with debounce
    var searchTimeout;
    searchInput.addEventListener("input", function (e) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        searchQuery = e.target.value.trim();
        applyFilters();
      }, 250);
    });

    // Sort
    sortSelect.addEventListener("change", function (e) {
      sortBy = e.target.value;
      applyFilters();
    });

    // Date filter
    dateFilter.addEventListener("change", function () {
      applyFilters();
    });

    // Reading filter
    var readingFilterEl = document.getElementById("reading-filter");
    if (readingFilterEl) {
      readingFilterEl.addEventListener("change", function (e) {
        readingFilter = e.target.value;
        applyFilters();
      });
    }

    // Solution area filter
    var saFilterEl = document.getElementById("solution-area-filter");
    if (saFilterEl) {
      saFilterEl.addEventListener("change", function (e) {
        currentSolutionArea = e.target.value;
        applyFilters();
      });
    }

    // Revenue type filter
    var rtFilterEl = document.getElementById("revenue-filter");
    if (rtFilterEl) {
      rtFilterEl.addEventListener("change", function (e) {
        currentRevenueType = e.target.value;
        applyFilters();
      });
    }

    // Blog source filter
    var blogSourceFilterEl = document.getElementById("blog-source-filter");
    if (blogSourceFilterEl) {
      blogSourceFilterEl.addEventListener("change", function (e) {
        currentBlogSource = e.target.value;
        applyFilters();
      });
    }

    // Theme toggle
    themeToggle.addEventListener("click", toggleTheme);

    // Category and blog pills (event delegation)
    filterPills.addEventListener("click", function (e) {
      // Category pill click
      var catPill = e.target.closest(".category-pill");
      if (catPill) {
        filterPills.querySelectorAll(".category-pill").forEach(function (p) {
          p.classList.remove("active");
        });
        catPill.classList.add("active");
        currentCategory = catPill.dataset.category;
        currentFilter = "all";
        renderBlogPills(currentCategory);
        applyFilters();
        return;
      }

      // Blog pill click
      var pill = e.target.closest(".pill");
      if (pill) {
        var blogPillsContainer = document.getElementById("blog-filter-pills");
        if (blogPillsContainer) {
          blogPillsContainer.querySelectorAll(".pill").forEach(function (p) {
            p.classList.remove("active");
          });
        }
        pill.classList.add("active");
        currentFilter = pill.dataset.filter;
        applyFilters();
      }
    });

    // Bookmarks toggle
    bookmarksToggle.addEventListener("click", function () {
      showBookmarksOnly = !showBookmarksOnly;
      bookmarksToggle.classList.toggle("active", showBookmarksOnly);
      bookmarksToggle.textContent = showBookmarksOnly
        ? "⭐ Showing Bookmarks"
        : "⭐ Bookmarks";
      applyFilters();
    });

    // Article actions (event delegation on grid)
    articlesGrid.addEventListener("click", function (e) {
      // Auto-mark as read when clicking article title link
      var trackLink = e.target.closest("[data-trackread]");
      if (trackLink) {
        var link = decodeURIComponent(trackLink.dataset.trackread);
        markAsRead(link);
        // Don't re-render immediately — let the link open first
        setTimeout(function () { applyFilters(); }, 300);
        return;
      }

      var btn = e.target.closest("[data-action]");
      if (!btn) return;

      var encodedLink = btn.dataset.link;
      var article = findArticleByEncodedLink(encodedLink);
      if (!article) return;

      if (btn.dataset.action === "bookmark") {
        toggleBookmark(article.link);
      } else if (btn.dataset.action === "reading") {
        cycleReadingStatus(article.link);
      }
    });

    // Keyboard shortcut: Ctrl/Cmd + K to focus search
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  // ===== Start =====
  document.addEventListener("DOMContentLoaded", init);
})();
