addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url     = new URL(request.url);
  const rawPath = url.searchParams.get('path') || '';

  // Normalize path: strip any leading/trailing slashes
  const trimmed = rawPath.replace(/^\/+|\/+$/g, '');

  // Prepare base paths
  let folder    = trimmed ? `${trimmed}/` : '';
  let htmlIndex = `${folder}index.html`;
  const jsonIndex = `${folder}project.json`;

  // ----- Case 1: check existence of folder/project.json via HEAD -----
  let headRes = await fetch(new URL(jsonIndex, request.url), { method: 'HEAD' });
  if (headRes.ok) {
    // Return only the link to the JSON
    return jsonResponse({
      type:        'icc_link',
      html_path:   htmlIndex,
      project:     jsonIndex,
      folder_path: folder
    });
  }

  // ----- Case 2: user passed a filename -----
  // Try trimmed + '.html' only if trimmed does not already end with '.html'
  let htmlCandidate = '';
  if (!trimmed.endsWith('.html')) {
    htmlCandidate = `${trimmed}.html`;
    let htmlRes = await fetch(new URL(htmlCandidate, request.url), { method: 'HEAD' });
    if (htmlRes.ok) {
        // Update folder and htmlIndex
        const segments = trimmed.split('/');
        segments.pop();
        folder = segments.length ? segments.join('/') + '/' : '';
        htmlIndex = htmlCandidate;

        // Check existence of updated folder/project.json via HEAD
        let projHead = await fetch(new URL(`${folder}project.json`, request.url), { method: 'HEAD' });
        if (projHead.ok) {
          return jsonResponse({
            type:        'icc_link',
            html_path:   htmlIndex,
            project:     `${folder}project.json`,
            folder_path: folder
          });
      }
    }
  }

  // ----- Case 3 & 4: scrape index.html for app.{hash}.js -----
  const idxRes = await fetch(new URL(htmlIndex, request.url));
  if (idxRes.ok) {
    const htmlText = await idxRes.text();
    const m = htmlText.match(/app\.([A-Za-z0-9]{8})\.js/);
    if (m) {
      const jsFilename = m[0];
      const jsPath     = `${folder}js/${jsFilename}`;
      const jsRes      = await fetch(new URL(jsPath, request.url));
      if (jsRes.ok) {
        const jsText = await jsRes.text();

        // Case 3: try extracting JSON or JSON path from JS
        const extracted = await getProjectFromAppJs(jsText);
        if (extracted != null) {
          // If extracted is an object, return it directly; if string, it's a filename
          // For embedded JSON, keep type 'icc'
          const respType = typeof extracted === 'object' ? 'icc' : 'icc_link';
          return jsonResponse({
            type:        respType,
            html_path:   htmlIndex,
            project:     extracted,
            folder_path: folder
          });
        }

        // Case 4a: bundle mentions 'project.json' → 404
        if (jsText.includes('project.json')) {
          return jsonResponse({ reason: "project.json seems being required but not exists.", html_path: htmlIndex, folder_path: folder }, 404);
        }

        // Case 4b: find any other .json filename
        const otherMatch = jsText.match(/([A-Za-z0-9_\-]+\.json)/);
        if (otherMatch) {
          const altJson = otherMatch[1];
          // Check existence of altJson via HEAD
          const altHead = await fetch(new URL(`${folder}${altJson}`, request.url), { method: 'HEAD' });
          if (altHead.ok) {
            return jsonResponse({
              type:        'icc_link',
              html_path:   htmlIndex,
              project:     `${folder}${altJson}`,
              folder_path: folder
            });
          }
        }
      }
    }
  }

  // ----- Fallback: not found -----
  return jsonResponse({ reason: "Unknown", html_path: htmlIndex, folder_path: folder }, 404);
}

/**
 * Utility to send JSON responses
 */
function jsonResponse(body, status=200) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Try to pull JSON or .json path from JS bundle
 * Returns parsed object or filename string, or null
 */
function extractJsonFromAppJs(target) {
  const startToken = '{"isEditModeOnAll":';
  const start = target.indexOf(startToken);
  if (start !== -1) {
    let depth = 0, ptr = start;
    while (ptr < target.length) {
      const ch = target[ptr];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0 && ptr > start) {
        const jsonText = target.substring(start, ptr + 1);
        try { return JSON.parse(jsonText); } catch { return null; }
      }
      ptr++;
    }
    return null;
  }
  const match = target.match(/([A-Za-z0-9_\-]+\.json)/);
  return match ? match[1] : null;
}

async function getProjectFromAppJs(jsText) {
  try { return extractJsonFromAppJs(jsText); } catch { return null; }
}