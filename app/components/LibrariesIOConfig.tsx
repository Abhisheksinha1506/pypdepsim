"use client";
import { useState, useEffect } from "react";

type ConfigStatus = {
  configured: boolean;
  hasKey: boolean;
  source: string;
};

export default function LibrariesIOConfig() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showInput, setShowInput] = useState(false);

  useEffect(function () {
    checkStatus();
  }, []);

  async function checkStatus(): Promise<void> {
    try {
      const res = await fetch("/api/config/libraries-io");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setShowInput(!data.configured);
      }
    } catch {
      // Ignore errors
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: "API key cannot be empty" });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/config/libraries-io", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "API key configured successfully!" });
        setApiKey("");
        setShowInput(false);
        await checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to configure API key" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error: " + (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function removeApiKey(): Promise<void> {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/config/libraries-io", {
        method: "DELETE",
      });

      if (res.ok) {
        setMessage({ type: "success", text: "API key removed successfully" });
        await checkStatus();
      } else {
        setMessage({ type: "error", text: "Failed to remove API key" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error: " + (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-zinc-300 rounded-md p-4 mb-6 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-900">Libraries.io API Key</h3>
        {status?.configured && (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Configured</span>
        )}
      </div>
      <p className="text-xs text-zinc-600 mb-3">
        Optional: Add your Libraries.io API key for enhanced similarity & co-occurrence data (fresher than CSV).
        <a href="https://libraries.io" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
          Get API key →
        </a>
      </p>

      {message && (
        <div className={`mb-3 p-2 rounded text-xs ${
          message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
        }`}>
          {message.text}
        </div>
      )}

      {status?.configured ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">API key is configured ({status.source})</span>
          <button
            onClick={removeApiKey}
            disabled={loading}
            className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
          >
            {loading ? "Removing..." : "Remove"}
          </button>
        </div>
      ) : (
        <div>
          {showInput && (
            <div className="flex gap-2 mb-2">
              <input
                type="password"
                value={apiKey}
                onChange={function (e) { setApiKey(e.target.value); }}
                placeholder="Enter Libraries.io API key"
                className="flex-1 text-sm border border-zinc-300 rounded px-2 py-1"
                onKeyDown={function (e) {
                  if (e.key === "Enter") {
                    saveApiKey();
                  }
                }}
              />
              <button
                onClick={saveApiKey}
                disabled={loading || !apiKey.trim()}
                className="text-xs px-3 py-1 bg-black text-white rounded hover:bg-zinc-800 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          )}
          {!showInput && (
            <button
              onClick={function () { setShowInput(true); }}
              className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Configure API Key
            </button>
          )}
        </div>
      )}
    </div>
  );
}




