import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../store.js";

function makeItem(overrides = {}) {
  return {
    id: "id-1",
    title: "buy milk",
    done: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("list returns a copy of the items", () => {
  const store = createStore();
  const item = makeItem();
  store.create(item);
  const list = store.list();
  assert.deepEqual(list, [item]);
  list.push(makeItem({ id: "other" }));
  assert.equal(store.list().length, 1);
});

test("create appends an item", async () => {
  const store = createStore();
  const item = makeItem();
  await store.create(item);
  assert.deepEqual(store.list(), [item]);
});

test("toggle flips the done flag", async () => {
  const store = createStore();
  await store.create(makeItem());
  const updated = await store.toggle("id-1");
  assert.equal(updated.done, true);
  const toggledBack = await store.toggle("id-1");
  assert.equal(toggledBack.done, false);
});

test("toggle returns null for unknown id", async () => {
  const store = createStore();
  assert.equal(await store.toggle("nope"), null);
});

test("remove deletes an item", async () => {
  const store = createStore();
  await store.create(makeItem());
  const removed = await store.remove("id-1");
  assert.equal(removed.id, "id-1");
  assert.deepEqual(store.list(), []);
});

test("remove returns null for unknown id", async () => {
  const store = createStore();
  assert.equal(await store.remove("nope"), null);
});
