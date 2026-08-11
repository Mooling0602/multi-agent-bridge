import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../cli.js";

test("parses add with a title", () => {
  assert.deepEqual(parseArgs(["add", "buy", "milk"]), {
    command: "add",
    args: ["buy", "milk"],
  });
});

test("parses list", () => {
  assert.deepEqual(parseArgs(["list"]), { command: "list", args: [] });
});

test("parses done with an id", () => {
  assert.deepEqual(parseArgs(["done", "abc"]), { command: "done", args: ["abc"] });
});

test("parses rm with an id", () => {
  assert.deepEqual(parseArgs(["rm", "abc"]), { command: "rm", args: ["abc"] });
});

test("throws when no command is given", () => {
  assert.throws(() => parseArgs([]), /Missing command/);
});
