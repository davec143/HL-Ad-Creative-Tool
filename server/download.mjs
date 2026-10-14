// Stop reading oversized responses while they are arriving. Checking arrayBuffer().length only
// afterwards permits a bad CDN response to exhaust the server before its size can be rejected.
export async function readBounded(res, limit, label) {
  const tooLarge = () => Object.assign(new Error(label + " is larger than " + Math.round(limit / 1024 / 1024) + " MB"), { code: "download_too_large" });
  if (Number(res.headers.get("content-length") || 0) > limit) {
    await res.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!res.body?.[Symbol.asyncIterator]) {
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > limit) throw tooLarge();
    return bytes;
  }
  const chunks = []; let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > limit) throw tooLarge(); // for-await closes/cancels the stream on failure
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}
