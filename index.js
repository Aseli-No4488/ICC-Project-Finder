addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * Try to pull a JSON blob out of the bundle, or locate an
 * alternate .json filename. Returns:
 *  - a JS object if it successfully extracts & parses the embedded JSON,
 *  - a string like "project.json" if it finds a different JSON filename,
 *  - null on any failure.
 */
function extractJsonFromAppJs(target) {
  const startingWord = '{"isEditModeOnAll":';
  const start = target.indexOf(startingWord);

  // Case A: we found the embedded JSON start
  if (start !== -1) {
    let ptr = start;
    let depth = 0;
    let closed = false;

    while (ptr < target.length) {
      const ch = target[ptr];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;

      if (depth === 0 && ptr > start) {
        closed = true;
        break;
      }
      ptr++;
    }

    if (closed) {
      const jsonText = target.substring(start, ptr + 1);
      try {
        return JSON.parse(jsonText);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  // Case B: no embedded JSON → look for any ".json" path
  const jsonMatch = target.match(/([A-Za-z0-9_\-]+\.json)/);
  return jsonMatch
    ? jsonMatch[1]    // e.g. "otherProject.json"
    : null;
}

/**
 * Wrapper that catches any extractor errors,
 * ensuring we only ever get a value or null.
 */
async function getProjectFromAppJs(jsText) {
  try {
    return extractJsonFromAppJs(jsText);
  } catch (e) {
    return null;
  }
}

async function handleRequest(request) {
  const url     = new URL(request.url);
  const rawPath = url.searchParams.get('path') || '';
  const norm    = rawPath.replace(/^\/+|\/+$/g, '');
  const folder  = norm ? `${norm}/` : '';
  const htmlPath = `${folder}index.html`;
  const jsonPath = `${folder}project.json`;

  // Case 1: folder/project.json
  let res = await fetch(new URL(jsonPath, request.url));
  if (res.ok) {
    const project = await res.json();
    return new Response(JSON.stringify({
      type:        'icc',
      html_path:   htmlPath,
      project:     project,
      folder_path: folder
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Case 2: maybe they passed a filename → try <name>.html + its folder/project.json
  const trimmed       = rawPath.replace(/\/+$/, '');
  const htmlCandidate = `${trimmed}.html`;
  let htmlRes = await fetch(new URL(htmlCandidate, request.url));
  if (htmlRes.ok) {
    const parts   = trimmed.split('/');
    parts.pop();
    const folder2 = parts.length ? parts.join('/') + '/' : '';
    let projRes  = await fetch(new URL(`${folder2}project.json`, request.url));
    if (projRes.ok) {
      const project = await projRes.json();
      return new Response(JSON.stringify({
        type:        'icc',
        html_path:   htmlCandidate,
        project:     project,
        folder_path: folder2
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Case 3 & 4: scrape index.html for app.{hash}.js in /js/, then extract or fallback
  const idxRes = await fetch(new URL(htmlPath, request.url));
  if (idxRes.ok) {
    const htmlText = await idxRes.text();
    const m = htmlText.match(/app\.([A-Za-z0-9]{8})\.js/);
    if (m) {
      const jsFilename = m[0];
      const jsPath     = `${folder}js/${jsFilename}`;
      const jsRes      = await fetch(new URL(jsPath, request.url));
      if (jsRes.ok) {
        const jsText = await jsRes.text();

        // first, see if we can pull JSON out of it
        const extracted = await getProjectFromAppJs(jsText);
        if (extracted != null) {
          return new Response(JSON.stringify({
            type:        'icc',
            html_path:   htmlPath,
            project:     extracted,
            folder_path: folder
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // if the bundle mentions "project.json" at all, give up
        if (jsText.includes('project.json')) {
          return new Response('Not found', { status: 404 });
        }

        // otherwise look for another .json filename and fetch it
        const otherMatch = jsText.match(/([A-Za-z0-9_\-]+\.json)/);
        if (otherMatch) {
          const altJson = otherMatch[1];
          const altRes  = await fetch(new URL(`${folder}${altJson}`, request.url));
          if (altRes.ok) {
            const altText = await altRes.text();
            return new Response(JSON.stringify({
              type:        'icc',
              html_path:   htmlPath,
              project:     altText,
              folder_path: folder
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      }
    }
  }

  // nothing worked
  return new Response('Not found', { status: 404 });
}
