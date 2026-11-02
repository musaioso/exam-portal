import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { auth, createChapter, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("create batch, upload pages, audit unnumbered, confirm opener", async () => {
  const teacher = await createUser("teacher");
  const q = await createQuestion({});
  const chapter = await createChapter(q.subjectId, 4, "CH. 04: Topography");
  const create = await fetch(`${server.baseUrl}/api/batches`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: q.subjectId, chapter_id: chapter.id, target_count: 5,
      max_per_page: 2, provider: "google", model: "gemini-2.5-flash",
    }),
  });
  assert.equal(create.status, 200);
  const { id } = await create.json();

  const form = new FormData();
  form.append("pages", new Blob([Buffer.from("png")], { type: "image/png" }), "BGS conv 55.png");
  const upload = await fetch(`${server.baseUrl}/api/batches/${id}/pages`, {
    method: "POST", headers: auth(teacher.token), body: form,
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).pages.length, 1);

  const audit = await fetch(`${server.baseUrl}/api/batches/${id}/audit`, {
    method: "POST", headers: auth(teacher.token),
  });
  assert.equal(audit.status, 200);
  const audited = await audit.json();
  assert.equal(audited.pages[0].page_number, 55);

  const confirm = await fetch(`${server.baseUrl}/api/batches/${id}/confirm-page`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ source_file: "BGS conv 55.png", resolved_page_number: 55 }),
  });
  assert.equal(confirm.status, 200);
  const detail = await (await fetch(`${server.baseUrl}/api/batches/${id}`, { headers: auth(teacher.token) })).json();
  assert.equal(detail.pages[0].audit_status, "confirmed");
});
