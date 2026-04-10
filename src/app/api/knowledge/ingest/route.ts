import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { chunkBySection, extractTextFromPdf, extractTextFromDocx } from "@/lib/knowledge/chunking";
import { embedDocuments } from "@/lib/knowledge/embeddings";

export const maxDuration = 300; // 5 min — embedding large docs takes time

// POST /api/knowledge/ingest — upload, extract, chunk, embed, store
export async function POST(request: NextRequest) {
  try {
    // Auth check — accept cookie auth OR internal service key
    const internalKey = request.headers.get("x-service-key");
    const isInternalCall =
      internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!isInternalCall) {
      const authSupabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await authSupabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;
    const standardId = formData.get("standard_id") as string | null;
    const description = (formData.get("description") as string) || null;

    if (!file || !name || !standardId) {
      return NextResponse.json(
        { error: "file, name, and standard_id are required" },
        { status: 400 }
      );
    }

    const fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "docx"].includes(ext)) {
      return NextResponse.json(
        { error: "Only .pdf and .docx files are supported" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Upload file to knowledge-docs bucket
    const storagePath = `${standardId}/${Date.now()}-${fileName}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("knowledge-docs")
      .upload(storagePath, buffer, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 2. Create knowledge_documents row with status "processing"
    const { data: doc, error: docError } = await supabase
      .from("knowledge_documents")
      .insert({
        name,
        file_name: fileName,
        standard_id: standardId,
        description,
        status: "processing",
        file_path: storagePath,
      })
      .select()
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { error: `Failed to create document: ${docError?.message}` },
        { status: 500 }
      );
    }

    const documentId = doc.id;

    // Process synchronously — maxDuration = 300 allows enough time
    let processError: string | null = null;
    try {
      await processDocument(supabase, documentId, buffer, ext);
    } catch (err) {
      processError = err instanceof Error ? err.stack || err.message : String(err);
      console.error("Ingest processing failed:", processError);
      await supabase
        .from("knowledge_documents")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", documentId);
    }

    // Re-fetch the final status
    const { data: finalDoc } = await supabase
      .from("knowledge_documents")
      .select("status, chunk_count")
      .eq("id", documentId)
      .single();

    return NextResponse.json(
      {
        id: documentId,
        status: finalDoc?.status || "processing",
        chunk_count: finalDoc?.chunk_count || 0,
        file_path: storagePath,
        ...(processError ? { debug_error: processError } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Knowledge ingest error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function processDocument(
  supabase: ReturnType<typeof createServiceClient>,
  documentId: string,
  buffer: Buffer,
  ext: string
) {
  // 1. Extract text
  let text: string;
  if (ext === "pdf") {
    text = await extractTextFromPdf(buffer);
  } else {
    text = await extractTextFromDocx(buffer);
  }

  if (!text.trim()) {
    await supabase
      .from("knowledge_documents")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", documentId);
    return;
  }

  // 2. Chunk by section structure
  const chunks = chunkBySection(text);

  if (chunks.length === 0) {
    await supabase
      .from("knowledge_documents")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", documentId);
    return;
  }

  // 3. Generate embeddings via Voyage AI
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedDocuments(texts);

  // 4. Insert chunks with embeddings
  const rows = chunks.map((chunk, i) => ({
    document_id: documentId,
    content: chunk.content,
    embedding: JSON.stringify(embeddings[i]),
    section_number: chunk.sectionNumber,
    section_title: chunk.sectionTitle,
    page_number: chunk.pageNumber,
    chunk_index: chunk.chunkIndex,
    token_count: chunk.tokenCount,
  }));

  // Insert in batches of 50 to avoid payload limits
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error: chunkError } = await supabase.from("knowledge_chunks").insert(batch);
    if (chunkError) {
      console.error("Chunk insert error:", chunkError);
      await supabase
        .from("knowledge_documents")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return;
    }
  }

  // 5. Update document status to ready
  await supabase
    .from("knowledge_documents")
    .update({
      status: "ready",
      chunk_count: chunks.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}
