"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, Filter, Calendar, TrendingUp } from "lucide-react";
import { useDebounce } from "@/lib/hooks/useDebounce";

interface Confession {
  id: string;
  content: string;
  created_at: string;
  view_count: number;
  reactions?: { like: number; love: number };
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<Confession[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [minReactions, setMinReactions] = useState("");
  const [sortBy, setSortBy] = useState("relevance");
  const [showFilters, setShowFilters] = useState(false);

  const debouncedQuery = useDebounce(query, 300);

  const searchConfessions = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (dateFrom) params.append("dateFrom", dateFrom);
        if (dateTo) params.append("dateTo", dateTo);
        if (category) params.append("category", category);
        if (minReactions) params.append("minReactions", minReactions);
        params.append("sortBy", sortBy);

        const res = await fetch(`/api/confessions/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || data || []);

          // Save to recent searches
          const recentSearches = JSON.parse(
            localStorage.getItem("recentSearches") || "[]",
          );
          const updated = [
            searchQuery,
            ...recentSearches.filter((s: string) => s !== searchQuery),
          ].slice(0, 5);
          localStorage.setItem("recentSearches", JSON.stringify(updated));
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, category, minReactions, sortBy],
  );

  useEffect(() => {
    if (debouncedQuery) {
      searchConfessions(debouncedQuery);
      router.push(`/search?q=${encodeURIComponent(debouncedQuery)}`, {
        scroll: false,
      });
    }
  }, [debouncedQuery, searchConfessions, router]);

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  const recentSearches =
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("recentSearches") || "[]")
      : [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search confessions..."
            className="w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-gray-100 rounded-md"
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">All Categories</option>
                <option value="humor">Humor</option>
                <option value="serious">Serious</option>
                <option value="relationship">Relationship</option>
                <option value="work">Work</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Min Reactions
              </label>
              <input
                type="number"
                value={minReactions}
                onChange={(e) => setMinReactions(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="relevance">Relevance</option>
                <option value="recent">Most Recent</option>
                <option value="popular">Most Popular</option>
                <option value="reactions">Most Reactions</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {!query && recentSearches.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2 text-gray-500">
            Recent Searches
          </h3>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((search: string, i: number) => (
              <button
                key={i}
                onClick={() => setQuery(search)}
                className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                {search}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-gray-500">Searching...</div>
      )}

      {!loading && query && results.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-medium mb-2">No results found</h3>
          <p className="text-gray-500">
            Try different keywords or adjust your filters
          </p>
        </div>
      )}

      <div className="space-y-4">
        {results.map((confession) => (
          <div
            key={confession.id}
            className="p-4 border rounded-lg hover:shadow-md transition cursor-pointer"
            onClick={() => router.push(`/confessions/${confession.id}`)}
          >
            <p className="text-gray-800 dark:text-gray-200 mb-2">
              {highlightText(confession.content, query)}
            </p>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>
                {new Date(confession.created_at).toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                {confession.view_count} views
              </span>
              {confession.reactions && (
                <span>
                  {(confession.reactions.like || 0) +
                    (confession.reactions.love || 0)}{" "}
                  reactions
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
