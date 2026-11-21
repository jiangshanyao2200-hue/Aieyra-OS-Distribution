"""One bounded query, JSON in/out. This helper receives no conversation or key."""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")
try:
    from ddgs.ddgs import DDGS

    request = json.loads(sys.stdin.read(4096))
    query = request["query"]
    if not isinstance(query, str) or not query.strip() or len(query) > 400:
        raise ValueError("invalid query")
    DDGS.threads = 1
    with DDGS(timeout=12, verify=True) as search:
        rows = []
        last_error = None
        # Explicit ordering avoids random slow engines holding a working one.
        # Keep the total bounded under the parent request deadline.
        for backend in ("bing", "brave", "duckduckgo"):
            try:
                rows = search.text(query, max_results=6, backend=backend)
                if rows:
                    break
            except Exception as exc:
                if str(exc).strip() != "No results found.":
                    last_error = exc
        if not rows and last_error is not None:
            raise last_error
    results = [
        {"title": str(r.get("title", ""))[:200], "url": str(r.get("href", "")),
         "snippet": str(r.get("body", ""))[:1200]} for r in rows[:6] if len(str(r.get("href", "")).encode("utf-8")) <= 2000
    ]
    print(json.dumps({"results": results}, ensure_ascii=False))
except Exception as exc:
    # Engine exceptions may contain proxy credentials. Never return that text.
    print(json.dumps({"error": type(exc).__name__}))
    sys.exit(1)
