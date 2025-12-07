"use client";
import { useEffect, useRef, useState } from "react";

type Similar = { name: string; jaccard: number; sharedDependents: number; sharedDependencies?: number };
type PackageMeta = { name: string; description: string; latest: string | null; dependencies: string[]; keywords: string[]; repository: string | null; downloads?: { recent: number; mirrors: number; total: number } | null };

export default function Home() {
  const [pkg, setPkg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Similar[]>([]);
  const [cooccur, setCooccur] = useState<Similar[]>([]);
  const [popular, setPopular] = useState<string[]>([]);
  const [meta, setMeta] = useState<PackageMeta | null>(null);
  const [hasSearched, setHasSearched] = useState(false); // Track if search has been performed
  const [openSuggest, setOpenSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number>(-1);
  const [darkMode, setDarkMode] = useState(false);
  const [openInfoSection, setOpenInfoSection] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Dark mode initialization and persistence
  useEffect(function () {
    const stored = localStorage.getItem("darkMode");
    const isDark = stored === "true" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  function toggleDarkMode(): void {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));
    if (newMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  useEffect(function () {
    let mounted = true;
    (async function loadPopular() {
      try {
        const res = await fetch("/api/categories/popular");
        if (!res.ok) return;
        const json = await res.json();
        const list: string[] = Array.isArray(json?.packages) ? json.packages : [];
        if (mounted) setPopular(list);
      } catch {
        // ignore
      }
    })();
    return function () { mounted = false; };
  }, []);

  async function queryLive(): Promise<{ similar: Similar[]; cooccur: Similar[]; meta: PackageMeta | null }> {
    // Fetch all APIs in parallel (cache will be used by default, much faster)
    const similarUrl = `/api/similar/${encodeURIComponent(pkg)}`;
    const metaUrl = `/api/meta/${encodeURIComponent(pkg)}`;
    
    const [similarRes, metaRes] = await Promise.all([
      fetch(similarUrl),
      fetch(metaUrl)
    ]);
    
    if (!similarRes.ok) throw new Error("REST query failed");
    
    const similarJson = await similarRes.json();
    const mapItem = function (r: { name: string; score?: number; jaccard?: number; sharedDependents?: number; sharedDependencies?: number }): Similar {
      const j = typeof r.jaccard === "number" ? r.jaccard : (typeof r.score === "number" ? r.score : 0);
      const shared = typeof r.sharedDependencies === "number"
        ? r.sharedDependencies
        : (typeof r.sharedDependents === "number" ? r.sharedDependents : 0);
      return { name: r.name, jaccard: j, sharedDependents: shared, sharedDependencies: r.sharedDependencies } as Similar;
    };
    const similarItems = Array.isArray(similarJson?.similar) ? similarJson.similar.map(mapItem) : [];
    const cooccurItems = Array.isArray(similarJson?.cooccur) ? similarJson.cooccur.map(mapItem) : [];
    
    // Parse metadata
    let packageMeta: PackageMeta | null = null;
    if (metaRes.ok) {
      try {
        const metaJson = await metaRes.json();
        packageMeta = {
          name: metaJson.name || pkg,
          description: metaJson.description || "",
          latest: metaJson.latest || null,
          dependencies: Array.isArray(metaJson.dependencies) ? metaJson.dependencies : [],
          keywords: Array.isArray(metaJson.keywords) ? metaJson.keywords : [],
          repository: metaJson.repository || null,
          downloads: metaJson.downloads || null,
        };
      } catch {
        // ignore meta parsing errors
      }
    }
    
    return { similar: similarItems, cooccur: cooccurItems, meta: packageMeta };
  }

  async function onSearch(): Promise<void> {
    setError(null);
    setResults([]);
    setCooccur([]);
    setMeta(null);
    setHasSearched(false); // Reset search state
    if (!pkg) return;
    setLoading(true);
    try {
      const live = await queryLive();
      setResults(live.similar);
      setCooccur(live.cooccur);
      setMeta(live.meta);
      setHasSearched(true); // Mark that search has been performed
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to fetch");
      setHasSearched(true); // Mark as searched even on error
    } finally {
      setLoading(false);
    }
  }

  function filteredSuggestions(): string[] {
    const q = pkg.trim().toLowerCase();
    if (!q) return popular.slice(0, 10);
    const starts = popular.filter(function (n) { return n.toLowerCase().startsWith(q); }).slice(0, 10);
    if (starts.length >= 10) return starts;
    const contains = popular.filter(function (n) { return n.toLowerCase().includes(q) && !n.toLowerCase().startsWith(q); }).slice(0, 10 - starts.length);
    return starts.concat(contains);
  }

  function onPickSuggestion(name: string): void {
    setPkg(name);
    setOpenSuggest(false);
    setHighlightIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    const items = filteredSuggestions();
    if (!openSuggest && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpenSuggest(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items.length === 0 ? -1 : (highlightIdx + 1) % items.length;
      setHighlightIdx(next);
      if (next >= 0) setPkg(items[next]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = items.length === 0 ? -1 : (highlightIdx - 1 + items.length) % items.length;
      setHighlightIdx(next);
      if (next >= 0) setPkg(items[next]);
    } else if (e.key === "Enter") {
      setOpenSuggest(false);
      setHighlightIdx(-1);
      void onSearch();
    } else if (e.key === "Escape") {
      setOpenSuggest(false);
      setHighlightIdx(-1);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-100 dark:from-zinc-900 dark:via-zinc-800 dark:to-zinc-900 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12 relative">
          <button
            onClick={toggleDarkMode}
            className="absolute top-0 right-0 p-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <svg className="w-5 h-5 text-zinc-900 dark:text-zinc-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-zinc-900 dark:text-zinc-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 bg-gradient-to-r from-zinc-900 to-zinc-700 dark:from-zinc-100 dark:to-zinc-300 bg-clip-text text-transparent">
            pypdepsim
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto mb-2">
            Discover similar Python packages using Jaccard similarity analysis on shared dependencies
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500 max-w-2xl mx-auto">
            Search for any Python package to find similar alternatives and commonly used companion packages
          </p>
        </div>

        {/* Information Sections */}
        <div className="mb-8 space-y-3">
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              onClick={function () { setOpenInfoSection(openInfoSection === "about" ? null : "about"); }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              About
            </button>
            <button
              onClick={function () { setOpenInfoSection(openInfoSection === "how-it-works" ? null : "how-it-works"); }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              How It Works
            </button>
            <button
              onClick={function () { setOpenInfoSection(openInfoSection === "examples" ? null : "examples"); }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Examples
            </button>
            <button
              onClick={function () { setOpenInfoSection(openInfoSection === "faq" ? null : "faq"); }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              FAQ
            </button>
            <button
              onClick={function () { setOpenInfoSection(openInfoSection === "usage" ? null : "usage"); }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Usage Guide
            </button>
          </div>

          {/* About Section */}
          {openInfoSection === "about" && (
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg">
              <h3 className="text-xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">About pypdepsim</h3>
              <div className="space-y-3 text-zinc-700 dark:text-zinc-300">
                <p>
                  <strong className="text-zinc-900 dark:text-zinc-100">pypdepsim</strong> is a tool that helps Python developers discover similar packages by analyzing shared dependencies and reverse dependencies. It uses advanced similarity algorithms to find packages that are commonly used together or serve similar purposes.
                </p>
                <p>
                  Whether you're looking for alternatives to a package, exploring the Python ecosystem, or trying to understand package relationships, pypdepsim provides insights based on real usage patterns from the PyPI ecosystem.
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  All data is sourced from PyPI (Python Package Index) and Libraries.io, ensuring accurate and up-to-date information.
                </p>
              </div>
            </div>
          )}

          {/* How It Works Section */}
          {openInfoSection === "how-it-works" && (
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg">
              <h3 className="text-xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">How It Works</h3>
              <div className="space-y-4 text-zinc-700 dark:text-zinc-300">
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Jaccard Similarity</h4>
                  <p className="text-sm mb-2">
                    The tool uses <strong>Jaccard similarity</strong> to measure how similar two packages are. Jaccard similarity compares the overlap between two sets:
                  </p>
                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-sm font-mono text-zinc-800 dark:text-zinc-200 mb-2">
                    Jaccard = (Packages using both A and B) / (Packages using A or B)
                  </div>
                  <p className="text-sm">
                    A score of 1.0 means perfect similarity (same packages use both), while 0.0 means no overlap.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Similar Packages</h4>
                  <p className="text-sm">
                    Packages are considered "similar" if they share many of the same reverse dependents (packages that depend on them). This indicates they serve similar purposes or are used in similar contexts.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Co-occurring Packages</h4>
                  <p className="text-sm">
                    These are packages that are commonly used together with your searched package. They appear in the dependency lists of packages that use your searched package, indicating they're often used in combination.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Examples Section */}
          {openInfoSection === "examples" && (
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg">
              <h3 className="text-xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">Example Searches</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Popular Packages</h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {["requests", "pandas", "numpy", "flask", "django"].map(function (name) {
                      return (
                        <button
                          key={name}
                          onClick={function () { 
                            setPkg(name); 
                            setOpenInfoSection(null); 
                            setTimeout(function () { void onSearch(); }, 100);
                          }}
                          className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">What to Expect</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                    <li>For popular packages like <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">requests</code>, you'll see many similar packages with high similarity scores</li>
                    <li>For specialized packages, you might see fewer but more relevant results</li>
                    <li>Co-occurring packages show what's commonly used alongside your package</li>
                    <li>Results are sorted by similarity score, with the most similar packages first</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* FAQ Section */}
          {openInfoSection === "faq" && (
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg">
              <h3 className="text-xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">Frequently Asked Questions</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">What's the difference between "similar" and "co-occurring" packages?</h4>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    <strong>Similar packages</strong> share many of the same dependents (packages that use them), indicating they serve similar purposes. <strong>Co-occurring packages</strong> are commonly found together in the same dependency lists, meaning they're often used in combination.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">How accurate are the results?</h4>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    Results are based on real usage data from PyPI. The similarity scores reflect actual patterns in how packages are used together in the Python ecosystem.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Why are there no results for some packages?</h4>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    Packages with few or no dependents may not have enough data for similarity analysis. New or rarely-used packages may have limited results.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">How often is the data updated?</h4>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    Package metadata is fetched in real-time from PyPI. Reverse dependency data is updated regularly from Libraries.io data dumps.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Usage Guide Section */}
          {openInfoSection === "usage" && (
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg">
              <h3 className="text-xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">Usage Guide for Beginners</h3>
              <div className="space-y-4 text-zinc-700 dark:text-zinc-300">
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">How to Search</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm mb-3">
                    <li>Type the name of any Python package in the search box (e.g., <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">requests</code>, <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">pandas</code>, <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">numpy</code>)</li>
                    <li>Click "Find Similar" or press Enter to search</li>
                    <li>Wait for the results to load (this may take a few seconds)</li>
                  </ol>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    <strong>Tip:</strong> You can use the autocomplete suggestions that appear as you type to find packages quickly.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Understanding the Results</h4>
                  <p className="text-sm mb-2">After searching, you'll see three main sections:</p>
                  <div className="space-y-3">
                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3">
                      <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">1. Package Metadata</h5>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300">
                        Shows the package description, latest version, number of dependencies, download statistics, and repository link.
                      </p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3">
                      <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">2. Similar Packages</h5>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 mb-1">
                        Packages that serve similar purposes or are used in similar contexts. Each result shows:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-zinc-600 dark:text-zinc-400 ml-2">
                        <li><strong>Similarity percentage</strong>: 0-100% - Higher means more similar</li>
                        <li><strong>Shared dependents</strong>: Number of packages that use both your package and this one</li>
                        <li><strong>Progress bar</strong>: Visual representation of similarity (green = high, blue = medium, gray = low)</li>
                      </ul>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3">
                      <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">3. Co-occurring Packages</h5>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 mb-1">
                        Packages commonly used together with your searched package. Each result shows:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-zinc-600 dark:text-zinc-400 ml-2">
                        <li><strong>Co-occurrence percentage</strong>: How often they appear together</li>
                        <li><strong>Co-occurrences count</strong>: Number of times they're found together in dependency lists</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">What the Numbers Mean</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><strong>Similarity Score (0-100%)</strong>: 
                      <ul className="list-disc list-inside ml-4 mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        <li>80-100%: Very similar, likely alternatives</li>
                        <li>50-79%: Moderately similar, related functionality</li>
                        <li>20-49%: Somewhat similar, may share use cases</li>
                        <li>0-19%: Low similarity, but still related</li>
                      </ul>
                    </li>
                    <li><strong>Shared Dependents</strong>: The number of packages that depend on both your searched package and the similar one. Higher numbers indicate stronger relationships.</li>
                    <li><strong>Downloads</strong>: Weekly download count from PyPI, indicating package popularity.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Next Steps</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li>Click on any package name or the "PyPI" link to view the package on PyPI.org</li>
                    <li>Read the package description and documentation</li>
                    <li>If you want to try a similar package, install it using:
                      <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 mt-1 text-xs font-mono text-zinc-800 dark:text-zinc-200">
                        pip install package-name
                      </div>
                    </li>
                  </ol>
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Example Use Cases</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <strong className="text-zinc-900 dark:text-zinc-100">Finding Alternatives:</strong>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        Search for <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">requests</code> to find alternatives like <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">httpx</code> or <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">aiohttp</code> in the "Similar Packages" section.
                      </p>
                    </div>
                    <div>
                      <strong className="text-zinc-900 dark:text-zinc-100">Discovering Related Tools:</strong>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        Search for <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">pandas</code> to see commonly used packages like <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">numpy</code>, <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">matplotlib</code>, or <code className="bg-zinc-100 dark:bg-zinc-900 px-1 rounded">scipy</code> in the "Co-occurring Packages" section.
                      </p>
                    </div>
                    <div>
                      <strong className="text-zinc-900 dark:text-zinc-100">Exploring the Ecosystem:</strong>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        Use the results to understand what packages are commonly used together in Python projects, helping you build better dependency lists.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6 relative">
          <div className="flex-1 relative">
            <input
              value={pkg}
              onChange={function (e) {
                const newValue = e.target.value;
                setPkg(newValue);
                setOpenSuggest(true);
                setHighlightIdx(-1);
                // Clear old results when input changes
                if (hasSearched) {
                  setResults([]);
                  setCooccur([]);
                  setMeta(null);
                  setError(null);
                  setHasSearched(false);
                }
              }}
              onFocus={function () { setOpenSuggest(true); }}
              onBlur={function () { setTimeout(function () { setOpenSuggest(false); }, 100); }}
              onKeyDown={onKeyDown}
              placeholder="Search for a package... (e.g. pandas, numpy, requests)"
              className="w-full border-2 border-zinc-300 dark:border-zinc-600 rounded-lg px-4 py-3 text-base focus:border-zinc-900 dark:focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-400 focus:ring-opacity-20 dark:focus:ring-opacity-30 transition-all outline-none bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500"
              ref={inputRef}
            />
          </div>
          <button 
            onClick={onSearch} 
            disabled={loading || !pkg} 
            className="px-6 py-3 rounded-lg bg-zinc-900 dark:bg-zinc-700 text-white dark:text-zinc-100 font-medium disabled:bg-zinc-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed hover:bg-zinc-800 dark:hover:bg-zinc-600 active:bg-zinc-900 dark:active:bg-zinc-800 transition-all shadow-md hover:shadow-lg disabled:shadow-none min-w-[140px] flex items-center justify-center"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching…
              </span>
            ) : (
              "Find Similar"
            )}
          </button>

          {openSuggest && (
            <div className="absolute left-0 right-0 top-full mt-2 z-10 bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-600 rounded-lg shadow-xl max-h-64 overflow-auto">
              {popular.length > 0 ? (
                filteredSuggestions().length > 0 ? (
                  filteredSuggestions().map(function (name, idx) {
                    const active = idx === highlightIdx;
                    return (
                      <div
                        key={name}
                        role="option"
                        aria-selected={active}
                        onMouseDown={function (e) { e.preventDefault(); }}
                        onClick={function () { onPickSuggestion(name); }}
                        className={(active ? "bg-zinc-100 dark:bg-zinc-700 " : "") + "px-4 py-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors border-b border-zinc-100 dark:border-zinc-700 last:border-b-0"}
                      >
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400 text-center">No suggestions found</div>
                )
              ) : (
                <div className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400 text-center">Loading suggestions...</div>
              )}
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Error: {error}</span>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="space-y-6">
            {/* Loading Skeleton for Metadata */}
            <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm animate-pulse">
              <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3 mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/4"></div>
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4"></div>
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/2"></div>
              </div>
            </div>
            {/* Loading Skeleton for Results */}
            {[1, 2, 3].map(function (i) {
              return (
                <div key={i} className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-sm animate-pulse">
                  <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-1/4 mb-3"></div>
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded w-full mb-2"></div>
                  <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3"></div>
                </div>
              );
            })}
          </div>
        )}

        {/* Only show results sections after search has been performed */}
        {pkg && !loading && !error && hasSearched && (
          <>
            {/* Package Metadata */}
            {meta && (
              <div className="mb-8 bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    <span className="text-zinc-600 dark:text-zinc-400 font-normal">Package: </span>
                    {meta.name}
                  </h2>
                  {meta.latest && (
                    <span className="px-3 py-1 bg-zinc-900 dark:bg-zinc-700 text-white dark:text-zinc-100 text-sm font-medium rounded-full">
                      v{meta.latest}
                    </span>
                  )}
                </div>
                {meta.description && (
                  <p className="text-zinc-700 dark:text-zinc-300 mb-4 leading-relaxed">{meta.description}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <div>
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">Dependencies:</span>
                      <span className="ml-2 font-semibold text-zinc-900 dark:text-zinc-100">{meta.dependencies.length}</span>
                    </div>
                  </div>
                  {meta.downloads && (
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <div className="text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">Downloads: </span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{meta.downloads.recent.toLocaleString()}</span>
                        <span className="text-zinc-500 dark:text-zinc-500"> /week</span>
                      </div>
                    </div>
                  )}
                  {meta.repository && (
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <svg className="w-5 h-5 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      <a href={meta.repository} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline font-medium truncate">
                        {meta.repository}
                      </a>
                    </div>
                  )}
                </div>
                {meta.dependencies.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                    <div className="flex flex-wrap gap-2">
                      {meta.dependencies.slice(0, 15).map(function (dep) {
                        return (
                          <span key={dep} className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-md text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors">
                            {dep}
                          </span>
                        );
                      })}
                      {meta.dependencies.length > 15 && (
                        <span className="px-2.5 py-1 bg-zinc-50 dark:bg-zinc-800 rounded-md text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                          +{meta.dependencies.length - 15} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Similar Packages - always show after search */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="text-2xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">
                  Packages similar to <span className="text-zinc-600 dark:text-zinc-400">{pkg}</span>
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Based on Jaccard similarity of reverse dependents
                </p>
              </div>
              {results.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
                  {results.map(function (r, idx) {
                    const percentage = Math.min(100, Math.max(0, r.jaccard * 100));
                    const colorClass = percentage >= 30 ? "bg-green-500 dark:bg-green-600" : percentage >= 15 ? "bg-blue-500 dark:bg-blue-600" : "bg-zinc-900 dark:bg-zinc-600";
                    return (
                      <div key={r.name} className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-5 shadow-md hover:shadow-lg transition-all hover:border-zinc-300 dark:hover:border-zinc-600">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-400 dark:text-zinc-500">#{idx + 1}</span>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{r.name}</h3>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{percentage.toFixed(1)}%</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">similar</div>
                          </div>
                        </div>
                        <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full mt-3 mb-3 overflow-hidden">
                          <div 
                            className={`h-2.5 ${colorClass} rounded-full transition-all duration-500`} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-zinc-600 dark:text-zinc-400">
                            <span className="font-medium">{r.sharedDependents.toLocaleString()}</span> shared dependents
                          </div>
                          <a 
                            href={`https://pypi.org/project/${r.name}/`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-colors"
                          >
                            PyPI
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 mx-auto text-zinc-400 dark:text-zinc-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No similar packages found</p>
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">Try searching for a different package</p>
                </div>
              )}
            </div>

            {/* Co-occurring Packages - always show after search */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="text-2xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">
                  Packages that use <span className="text-zinc-600 dark:text-zinc-400">{pkg}</span> also use
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Based on co-occurrence within dependents' dependency lists
                </p>
              </div>
              {cooccur.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
                  {cooccur.map(function (r, idx) {
                    const percentage = Math.min(100, Math.max(0, r.jaccard * 100));
                    const colorClass = percentage >= 20 ? "bg-purple-500 dark:bg-purple-600" : percentage >= 10 ? "bg-indigo-500 dark:bg-indigo-600" : "bg-zinc-900 dark:bg-zinc-600";
                    return (
                      <div key={r.name} className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-5 shadow-md hover:shadow-lg transition-all hover:border-zinc-300 dark:hover:border-zinc-600">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-400 dark:text-zinc-500">#{idx + 1}</span>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{r.name}</h3>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{percentage.toFixed(1)}%</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">co-occurrence</div>
                          </div>
                        </div>
                        <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full mt-3 mb-3 overflow-hidden">
                          <div 
                            className={`h-2.5 ${colorClass} rounded-full transition-all duration-500`} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-zinc-600 dark:text-zinc-400">
                            <span className="font-medium">{r.sharedDependents.toLocaleString()}</span> co-occurrences
                          </div>
                          <a 
                            href={`https://pypi.org/project/${r.name}/`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-colors"
                          >
                            PyPI
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 mx-auto text-zinc-400 dark:text-zinc-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No co-occurring packages found</p>
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">This package may not have many dependents yet</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

