addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "";

  // Normalize path: strip any leading/trailing slashes
  let trimmed = rawPath.replace(/^\/+|\/+$/g, "");

  // If the path is empty, return a 404
  if (!trimmed) {
    return jsonResponse(
      { reason: "Path is empty", html_path: "index.html", folder_path: "" },
      404
    );
  }

  // If the path not includes http(s)://, Add https://
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    console.log("[0] Adding https:// to path:", trimmed);
    trimmed = "https://" + trimmed;
  }

  // Prepare base paths
  let folder = trimmed ? `${trimmed}/` : "";
  let htmlIndex = `${folder}index.html`;
  const jsonIndex = `${folder}project.json`;

  // ----- Case 1: check existence of folder/project.json via HEAD -----
  let headRes = await fetch(new URL(jsonIndex, request.url), {
    method: "HEAD",
  });

  if (headRes.ok) {
    console.log("[1] Found project.json at:", jsonIndex);
    // Return only the link to the JSON
    return jsonResponse({
      type: "icc_link",
      html_path: htmlIndex,
      project: jsonIndex,
      folder_path: folder,
    });
  }

  // ----- Case 2: user passed a filename -----
  // Try trimmed + '.html' only if trimmed does not already end with '.html'
  let htmlCandidate = "";

  if (!trimmed.endsWith(".html")) {
    console.log("[2] Checking for HTML candidate:", trimmed);

    htmlCandidate = `${trimmed}.html`;
    let htmlRes = await fetch(new URL(htmlCandidate, request.url), {
      method: "HEAD",
    });
    if (htmlRes.ok) {
      console.log("[2] Found HTML candidate:", htmlCandidate);

      // Update folder and htmlIndex
      const segments = trimmed.split("/");
      segments.pop();
      folder = segments.length ? segments.join("/") + "/" : "";
      htmlIndex = htmlCandidate;

      // Check existence of updated folder/project.json via HEAD
      let projHead = await fetch(
        new URL(`${folder}project.json`, request.url),
        { method: "HEAD" }
      );
      if (projHead.ok) {
        console.log("[2] Found project.json in folder:", folder);
        return jsonResponse({
          type: "icc_link",
          html_path: htmlIndex,
          project: `${folder}project.json`,
          folder_path: folder,
        });
      }
    }
  }

  // ----- Case 3 & 4: scrape index.html for app.{hash}.js -----
  const idxRes = await fetch(new URL(htmlIndex, request.url));
  if (idxRes.ok) {
    console.log("[4] Found index.html at:", htmlIndex);
    // Read the HTML content to find the app.{hash}.js file
    const htmlText = await idxRes.text();
    const m = htmlText.match(/app\.([A-Za-z0-9]{8})\.js/);
    if (m) {
      console.log("[4] Found app.js hash:", m[1]);
      const jsFilename = m[0];
      const jsPath = `${folder}js/${jsFilename}`;
      const jsRes = await fetch(new URL(jsPath, request.url));
      if (jsRes.ok) {
        const jsText = await jsRes.text();

        // Case 3: try extracting JSON or JSON path from JS
        const extracted = await getProjectFromAppJs(jsText);
        console.log("[4] Extracted from app.js:", extracted.length);

        if (extracted != null) {
          // If extracted is an object, return it directly; if string, it's a filename
          // For embedded JSON, keep type 'icc'
          const isExtracted = typeof extracted === "object";
          console.log(
            `[4] Type of extracted: ${typeof extracted} - ${
              isExtracted ? "1" : "0"
            }`
          );

          if (!isExtracted) {
            return jsonResponse({
              type: "icc_link",
              html_path: htmlIndex,
              project: `${folder}${extracted}`,
              folder_path: folder,
            });
          } else {
            // If extracted is an object, return it as JSON
            return jsonResponse({
              type: "icc",
              html_path: htmlIndex,
              project: extracted,
              folder_path: folder,
              message: "Extracted project from app.js",
            });
          }
        }

        // Case 4a: bundle mentions 'project.json' → 404
        if (jsText.includes("project.json")) {
          console.log("[4a] app.js mentions project.json but not found.");
          return jsonResponse(
            {
              reason: "project.json seems being required but not exists.",
              html_path: htmlIndex,
              folder_path: folder,
            },
            404
          );
        }
      }
    }
  }

  // ----- Fallback: not found -----
  console.log("[5] No project.json or app.js found, returning 404.");
  return jsonResponse(
    { reason: "Unknown", html_path: htmlIndex, folder_path: folder },
    404
  );
}

/**
 * Utility to send JSON responses
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Try to pull JSON or .json path from JS bundle
 * Returns parsed object or filename string, or null
 */
function extractJsonFromAppJs(target) {
  const startToken = '"isEditModeOnAll":';
  const start = target.indexOf(startToken);
  if (start !== -1) {
    let depth = 1, // First { is removed
      ptr = start;
    while (ptr < target.length) {
      const ch = target[ptr];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;

      if (depth === 0 && ptr > start) {
        const jsonText = "{" + target.substring(start, ptr + 1);
        try {
          // console.log("Extracted JSON from app.js:", jsonText);
          return JSON.parse(jsonText);
        } catch {
          console.warn(
            "Failed to parse JSON from app.js, trying to extract filename."
          );
          return null;
        }
      }
      ptr++;
    }
    return null;
  }
  const match = target.match(/([A-Za-z0-9_\-]+\.json)/);
  return match ? match[1] : null;
}

async function getProjectFromAppJs(jsText) {
  try {
    return extractJsonFromAppJs(jsText);
  } catch {
    return null;
  }
}
