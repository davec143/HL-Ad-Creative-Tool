import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBounded } from "../server/download.mjs";
import { fetchSourceImage } from "../server/source-image.mjs";
import { fetchRender } from "../server/finish.mjs";

test("streaming limits stop unknown-length and falsely advertised downloads immediately", async () => {
  for (const length of [null, "2"]) {
    let chunks = 0, closed = false;
    const res = { headers: new Headers(length ? {"content-length":length} : {}), body: (async function* () {
      try { for (let i=0;i<1000;i++) { chunks++; yield Buffer.alloc(1024); } } finally { closed = true; }
    })() };
    await assert.rejects(readBounded(res, 2048, "image"), {code:"download_too_large"});
    assert.equal(chunks, 3); assert.equal(closed, true);
  }
});

test("known oversize bodies are cancelled before consuming bytes; exact limit succeeds", async () => {
  let cancelled = false;
  await assert.rejects(readBounded({headers:new Headers({"content-length":"500"}),body:{cancel:async()=>{cancelled=true;}}},100,"image"), /larger/);
  assert.equal(cancelled,true);
  const expected=Buffer.from("abcdefgh");
  assert.deepEqual(await readBounded(new Response(expected),8,"image"),expected);
});

test("oversized product and render downloads preserve existing files and stop their streams", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hl-bounds-")), dest=path.join(dir,"image");
  try {
    for (const kind of ["source","render"]) {
      fs.writeFileSync(dest,"previous valid file");
      let calls=0, read=0, closed=false;
      const fetchImpl=async()=>{calls++; return {ok:true,status:200,headers:new Headers({"content-type":"image/png"}), body:(async function*(){
        try { for(let i=0;i<100;i++){read++;yield Buffer.alloc(1024*1024);} } finally {closed=true;}
      })()};};
      const job = kind === "source" ? fetchSourceImage("https://cdn.shopify.com/test.png",dest,{fetchImpl,lookup:async()=>[{address:"23.227.38.65"}]}) : fetchRender("https://example.com/render.png",dest,{fetchImpl});
      await assert.rejects(job,/larger than/);
      assert.equal(calls,1,"oversized responses are not retried");
      assert.equal(read,kind==="source"?16:65);
      assert.equal(closed,true);
      assert.equal(fs.readFileSync(dest,"utf8"),"previous valid file");
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test("rejected MIME/HTTP bodies and redirect bodies are cancelled", async () => {
  const dest=path.join(os.tmpdir(),"hl-rejected-source.img");
  for (const response of [{status:502,headers:{}},{status:200,headers:{"content-type":"text/html"}},{status:302,headers:{location:"https://cdn.shopify.com/next.png"}}]) {
    let cancelled=0,calls=0;
    const fetchImpl=async()=>{calls++;return {...response,ok:response.status===200,headers:new Headers(response.headers),body:{cancel:async()=>{cancelled++;}}};};
    await assert.rejects(fetchSourceImage("https://cdn.shopify.com/test.png",dest,{fetchImpl,lookup:async()=>[{address:"23.227.38.65"}]}));
    assert.equal(cancelled,calls);
  }
});
