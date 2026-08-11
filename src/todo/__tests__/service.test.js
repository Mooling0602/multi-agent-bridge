import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../store.js";
import { createService } from "../service.js";

function setup() {
  return createService(createStore());
}

test("create generates an id and stores the item", async () => {
  const service = setup();
  const item = await service.create("buy milk");
  assert.equal(item.title, "buy milk");
  assert.equal(item.done, false);
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(item.createdAt)));
});

test("create trims whitespace-only and long titles", async () => {
  const service = setup();
  const item = await service.create("  hello  ");
  assert.equal(item.title, "hello");
});

test("create rejects empty titles", async () => {
  const service = setup();
  await assert.rejects(() => service.create("   "), /non-empty/);
  await assert.rejects(() => service.create(""), /non-empty/);
});

test("create rejects titles longer than 200 chars", async () => {
  const service = setup();
  await assert.rejects(() => service.create("a".repeat(201)), /at most 200/);
  const ok = await service.create("a".repeat(200));
  assert.equal(ok.title.length, 200);
});

test("create rejects non-string titles", async () => {
  const service = setup();
  await assert.rejects(() => service.create(42), /non-empty/);
});

test("toggle requires an id", async () => {
  const service = setup();
  await assert.rejects(() => service.toggle(undefined), /Missing id/);
  await assert.rejects(() => service.toggle(""), /Missing id/);
});

test("toggle throws when item not found", async () => {
  const service = setup();
  await assert.rejects(() => service.toggle("nope"), /not found/);
});

test("toggle toggles an existing item", async () => {
  const service = setup();
  const { id } = await service.create("buy milk");
  const item = await service.toggle(id);
  assert.equal(item.done, true);
});

test("remove requires an id", async () => {
  const service = setup();
  await assert.rejects(() => service.remove(null), /Missing id/);
});

test("remove throws when item not found", async () => {
  const service = setup();
  await assert.rejects(() => service.remove("nope"), /not found/);
});

test("remove deletes an existing item", async () => {
  const service = setup();
  const { id } = await service.create("buy milk");
  const removed = await service.remove(id);
  assert.equal(removed.id, id);
  assert.deepEqual(await service.list(), []);
});
