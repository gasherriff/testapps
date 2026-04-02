const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const DEEPL_FREE_API_URL = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_API_URL = "https://api.deepl.com/v2/translate";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function translateWithDeepL(
  apiKey: string,
  text: string,
  targetLanguage: "EN-US" | "PT-BR",
  sourceLanguage?: "EN" | "PT"
) {
  const apiUrl = apiKey.endsWith(":fx") ? DEEPL_FREE_API_URL : DEEPL_PRO_API_URL;
  const payload: Record<string, unknown> = {
    text: [text],
    target_lang: targetLanguage
  };

  if (sourceLanguage) {
    payload.source_lang = sourceLanguage;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepL request failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const apiKey = Deno.env.get("DEEPL_API_KEY");

  if (!apiKey) {
    return jsonResponse({ error: "DEEPL_API_KEY is not configured." }, 500);
  }

  let text = "";

  try {
    const body = await request.json();
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!text) {
    return jsonResponse({
      translatedText: "",
      detectedLanguage: null,
      targetLanguage: null,
      unsupported: false
    });
  }

  try {
    const englishAttempt = await translateWithDeepL(apiKey, text, "EN-US");
    const englishResult = englishAttempt.translations?.[0];
    const detectedLanguage = englishResult?.detected_source_language || null;

    if (typeof detectedLanguage === "string" && detectedLanguage.startsWith("PT")) {
      return jsonResponse({
        translatedText: englishResult?.text || "",
        detectedLanguage: "PT-BR",
        targetLanguage: "EN-US",
        unsupported: false
      });
    }

    if (typeof detectedLanguage === "string" && detectedLanguage.startsWith("EN")) {
      const portugueseAttempt = await translateWithDeepL(apiKey, text, "PT-BR", "EN");
      const portugueseResult = portugueseAttempt.translations?.[0];

      return jsonResponse({
        translatedText: portugueseResult?.text || "",
        detectedLanguage: "EN",
        targetLanguage: "PT-BR",
        unsupported: false
      });
    }

    return jsonResponse({
      translatedText: "",
      detectedLanguage,
      targetLanguage: null,
      unsupported: true
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Translation failed." }, 500);
  }
});
