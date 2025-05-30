addEventListener('fetch', event => { event.respondWith(handleRequest(event.request)); });
async function handleRequest(request) { const url     = new URL(request.url); const rawPath = url.searchParams.get('path') || '';

// Normalize path: strip any leading/trailing slashes const trimmed = rawPath.replace(/^/+|/+$/g, '');

// Prepare base paths let folder    = trimmed ? ${trimmed}/ : ''; let htmlIndex = ${folder}index.html; const jsonIndex = ${folder}project.json;

// ----- Case 1: folder/project.json ----- let res = await fetch(new URL(jsonIndex, request.url)); if (res.ok) { const project = await res.json(); return jsonResponse({ type:        'icc', html_path:   htmlIndex, project, folder_path: folder }); }

// ----- Case 2: user passed a filename ----- const htmlCandidate = ${trimmed}.html; let htmlRes = await fetch(new URL(htmlCandidate, request.url)); if (htmlRes.ok) { // Update folder and htmlIndex const segments = trimmed.split('/'); segments.pop(); folder = segments.length ? segments.join('/') + '/' : ''; htmlIndex = htmlCandidate;

// Retry project.json in the updated folder
const projRes = await fetch(new URL(`${folder}project.json`, request.url));
if (projRes.ok) {
  const project = await projRes.json();
  return jsonResponse({
    type:        'icc',
    html_path:   htmlIndex,
    project,
    folder_path: folder
  });
}

}

// ----- Case 3 & 4: scrape index.html for app.{hash}.js ----- const idxRes = await fetch(new URL(htmlIndex, request.url)); if (idxRes.ok) { const htmlText = await idxRes.text(); const m = htmlText.match(/app.([A-Za-z0-9]{8}).js/); if (m) { const jsFilename = m[0]; const jsPath     = ${folder}js/${jsFilename}; const jsRes      = await fetch(new URL(jsPath, request.url)); if (jsRes.ok) { const jsText = await jsRes.text();

// Try extracting JSON or JSON path from JS
    const extracted = await getProjectFromAppJs(jsText);
    if (extracted != null) {
      return jsonResponse({
        type:        'icc',
        html_path:   htmlIndex,
        project:     extracted,
        folder_path: folder
      });
    }

    // Case 4a: bundle mentions 'project.json' → 404
    if (jsText.includes('project.json')) {
      return new Response('Not found', { status: 404 });
    }

    // Case 4b: find any other .json filename
    const otherMatch = jsText.match(/([A-Za-z0-9_\-]+\.json)/);
    if (otherMatch) {
      const altJson = otherMatch[1];
      const altRes  = await fetch(new URL(`${folder}${altJson}`, request.url));
      if (altRes.ok) {
        const altText = await altRes.text();
        return jsonResponse({
          type:        'icc',
          html_path:   htmlIndex,
          project:     altText,
          folder_path: folder
        });
      }
    }
  }
}

}

// ----- Fallback: not found ----- return new Response('Not found', { status: 404 }); }

/**

Utility to send JSON responses */ function jsonResponse(body) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }


/**

Try to pull JSON or .json path from JS bundle

Returns parsed object or filename string, or null */ function extractJsonFromAppJs(target) { const startToken = '{"isEditModeOnAll":'; const start = target.indexOf(startToken); if (start !== -1) { let depth = 0, ptr = start; while (ptr < target.length) { const ch = target[ptr]; if (ch === '{') depth++; else if (ch === '}') depth--; if (depth === 0 && ptr > start) { const jsonText = target.substring(start, ptr + 1); try { return JSON.parse(jsonText); } catch { return null; } } ptr++; } return null; } const match = target.match(/([A-Za-z0-9_-]+.json)/); return match ? match[1] : null; }


async function getProjectFromAppJs(jsText) { try { return extractJsonFromAppJs(jsText); } catch { return null; } }

