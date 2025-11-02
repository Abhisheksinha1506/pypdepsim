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
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-100 text-zinc-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 bg-gradient-to-r from-zinc-900 to-zinc-700 bg-clip-text text-transparent">
            pypdepsim
          </h1>
          <p className="text-zinc-600 text-base sm:text-lg max-w-2xl mx-auto">
            Discover similar Python packages using Jaccard similarity analysis on shared dependencies
          </p>
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
              className="w-full border-2 border-zinc-300 rounded-lg px-4 py-3 text-base focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900 focus:ring-opacity-20 transition-all outline-none bg-white shadow-sm hover:border-zinc-400"
              ref={inputRef}
            />
          </div>
          <button 
            onClick={onSearch} 
            disabled={loading || !pkg} 
            className="px-6 py-3 rounded-lg bg-zinc-900 text-white font-medium disabled:bg-zinc-400 disabled:cursor-not-allowed hover:bg-zinc-800 active:bg-zinc-900 transition-all shadow-md hover:shadow-lg disabled:shadow-none min-w-[140px] flex items-center justify-center"
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
            <div className="absolute left-0 right-0 top-full mt-2 z-10 bg-white border-2 border-zinc-200 rounded-lg shadow-xl max-h-64 overflow-auto">
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
                        className={(active ? "bg-zinc-100 " : "") + "px-4 py-2.5 cursor-pointer hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-b-0"}
                      >
                        <span className="text-sm font-medium">{name}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-4 py-3 text-sm text-zinc-500 text-center">No suggestions found</div>
                )
              ) : (
                <div className="px-4 py-3 text-sm text-zinc-500 text-center">Loading suggestions...</div>
              )}
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-2 border-red-200 rounded-lg text-red-800">
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
            <div className="bg-white border-2 border-zinc-200 rounded-xl p-6 shadow-sm animate-pulse">
              <div className="h-6 bg-zinc-200 rounded w-1/3 mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-zinc-200 rounded w-1/4"></div>
                <div className="h-4 bg-zinc-200 rounded w-3/4"></div>
                <div className="h-4 bg-zinc-200 rounded w-1/2"></div>
              </div>
            </div>
            {/* Loading Skeleton for Results */}
            {[1, 2, 3].map(function (i) {
              return (
                <div key={i} className="bg-white border-2 border-zinc-200 rounded-xl p-6 shadow-sm animate-pulse">
                  <div className="h-5 bg-zinc-200 rounded w-1/4 mb-3"></div>
                  <div className="h-2 bg-zinc-200 rounded w-full mb-2"></div>
                  <div className="h-3 bg-zinc-200 rounded w-1/3"></div>
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
              <div className="mb-8 bg-white border-2 border-zinc-200 rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-2xl font-bold text-zinc-900">
                    <span className="text-zinc-600 font-normal">Package: </span>
                    {meta.name}
                  </h2>
                  {meta.latest && (
                    <span className="px-3 py-1 bg-zinc-900 text-white text-sm font-medium rounded-full">
                      v{meta.latest}
                    </span>
                  )}
                </div>
                {meta.description && (
                  <p className="text-zinc-700 mb-4 leading-relaxed">{meta.description}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <div>
                      <span className="text-sm text-zinc-600">Dependencies:</span>
                      <span className="ml-2 font-semibold text-zinc-900">{meta.dependencies.length}</span>
                    </div>
                  </div>
                  {meta.downloads && (
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <div className="text-sm">
                        <span className="text-zinc-600">Downloads: </span>
                        <span className="font-semibold text-zinc-900">{meta.downloads.recent.toLocaleString()}</span>
                        <span className="text-zinc-500"> /week</span>
                      </div>
                    </div>
                  )}
                  {meta.repository && (
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      <a href={meta.repository} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline font-medium truncate">
                        {meta.repository}
                      </a>
                    </div>
                  )}
                </div>
                {meta.dependencies.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-200">
                    <div className="flex flex-wrap gap-2">
                      {meta.dependencies.slice(0, 15).map(function (dep) {
                        return (
                          <span key={dep} className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 rounded-md text-xs font-medium text-zinc-700 transition-colors">
                            {dep}
                          </span>
                        );
                      })}
                      {meta.dependencies.length > 15 && (
                        <span className="px-2.5 py-1 bg-zinc-50 rounded-md text-xs text-zinc-500 font-medium">
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
                <h2 className="text-2xl font-bold mb-2">
                  Packages similar to <span className="text-zinc-600">{pkg}</span>
                </h2>
                <p className="text-sm text-zinc-600">
                  Based on Jaccard similarity of reverse dependents
                </p>
              </div>
              {results.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
                  {results.map(function (r, idx) {
                    const percentage = Math.min(100, Math.max(0, r.jaccard * 100));
                    const colorClass = percentage >= 30 ? "bg-green-500" : percentage >= 15 ? "bg-blue-500" : "bg-zinc-900";
                    return (
                      <div key={r.name} className="bg-white border-2 border-zinc-200 rounded-xl p-5 shadow-md hover:shadow-lg transition-all hover:border-zinc-300">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-400">#{idx + 1}</span>
                            <h3 className="text-lg font-bold text-zinc-900">{r.name}</h3>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-zinc-900">{percentage.toFixed(1)}%</div>
                            <div className="text-xs text-zinc-500">similar</div>
                          </div>
                        </div>
                        <div className="h-2.5 bg-zinc-200 rounded-full mt-3 mb-3 overflow-hidden">
                          <div 
                            className={`h-2.5 ${colorClass} rounded-full transition-all duration-500`} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-zinc-600">
                            <span className="font-medium">{r.sharedDependents.toLocaleString()}</span> shared dependents
                          </div>
                          <a 
                            href={`https://pypi.org/project/${r.name}/`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
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
                <div className="bg-white border-2 border-zinc-200 rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 mx-auto text-zinc-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-zinc-500 font-medium">No similar packages found</p>
                  <p className="text-sm text-zinc-400 mt-1">Try searching for a different package</p>
                </div>
              )}
            </div>

            {/* Co-occurring Packages - always show after search */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="text-2xl font-bold mb-2">
                  Packages that use <span className="text-zinc-600">{pkg}</span> also use
                </h2>
                <p className="text-sm text-zinc-600">
                  Based on co-occurrence within dependents' dependency lists
                </p>
              </div>
              {cooccur.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
                  {cooccur.map(function (r, idx) {
                    const percentage = Math.min(100, Math.max(0, r.jaccard * 100));
                    const colorClass = percentage >= 20 ? "bg-purple-500" : percentage >= 10 ? "bg-indigo-500" : "bg-zinc-900";
                    return (
                      <div key={r.name} className="bg-white border-2 border-zinc-200 rounded-xl p-5 shadow-md hover:shadow-lg transition-all hover:border-zinc-300">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-400">#{idx + 1}</span>
                            <h3 className="text-lg font-bold text-zinc-900">{r.name}</h3>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-zinc-900">{percentage.toFixed(1)}%</div>
                            <div className="text-xs text-zinc-500">co-occurrence</div>
                          </div>
                        </div>
                        <div className="h-2.5 bg-zinc-200 rounded-full mt-3 mb-3 overflow-hidden">
                          <div 
                            className={`h-2.5 ${colorClass} rounded-full transition-all duration-500`} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-zinc-600">
                            <span className="font-medium">{r.sharedDependents.toLocaleString()}</span> co-occurrences
                          </div>
                          <a 
                            href={`https://pypi.org/project/${r.name}/`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
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
                <div className="bg-white border-2 border-zinc-200 rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 mx-auto text-zinc-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-zinc-500 font-medium">No co-occurring packages found</p>
                  <p className="text-sm text-zinc-400 mt-1">This package may not have many dependents yet</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

