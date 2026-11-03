import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("replace requires authentication", async () => {
  const res = await fetch(`${server.baseUrl}/api/corrections/any/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: ["x"] }),
  });
  assert.equal(res.status, 401);
});

test("replace validates item_ids", async () => {
  const teacher = await createUser("teacher");
  const res = await fetch(`${server.baseUrl}/api/corrections/any/replace`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("replace reports an unknown run", async () => {
  const teacher = await createUser("teacher");
  const res = await fetch(`${server.baseUrl}/api/corrections/not-a-run/replace`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: ["x"] }),
  });
  assert.equal(res.status, 400);
});
