const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite"; // 1024 dimensions
const BATCH_SIZE = 2; // Minimal batches for free-tier 10K TPM limit

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  return key;
}

interface VoyageEmbedResponse {
  data: { embedding: number[] }[];
  usage: { total_tokens: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callVoyageEmbed(
  texts: string[],
  inputType: "document" | "query",
  retries = 5
): Promise<number[][]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        input: texts,
        model: MODEL,
        input_type: inputType,
      }),
    });

    if (res.ok) {
      const json: VoyageEmbedResponse = await res.json();
      return json.data.map((d) => d.embedding);
    }

    if (res.status === 429 && attempt < retries) {
      // Rate limited — wait a full minute for TPM window to reset
      const delay = 62000;
      console.log(`Voyage AI rate limited, waiting 62s for TPM reset (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
      continue;
    }

    const body = await res.text();
    throw new Error(`Voyage AI error ${res.status}: ${body}`);
  }

  throw new Error("Voyage AI: max retries exceeded");
}

/**
 * Embed document chunks for storage. Uses input_type "document".
 * Returns arrays of 1024-dimension vectors.
 * Uses small batches + rate limit backoff for free tier compatibility.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchVectors = await callVoyageEmbed(batch, "document");
    vectors.push(...batchVectors);

    // Pace requests to stay under 3 RPM free tier limit
    if (i + BATCH_SIZE < texts.length) {
      await sleep(65000); // Stay under 3 RPM + 10K TPM free tier limits
    }
  }

  return vectors;
}

/**
 * Embed a search query. Uses input_type "query".
 * Returns a single 1024-dimension vector.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const vectors = await callVoyageEmbed([text], "query");
  if (vectors.length === 0) throw new Error("No embedding returned from Voyage AI");
  return vectors[0];
}
