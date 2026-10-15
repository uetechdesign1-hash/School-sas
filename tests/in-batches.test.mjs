import assert from "node:assert/strict";
import test from "node:test";

import { IN_BATCH_SIZE, inBatches } from "../src/lib/supabase/in-batches.ts";

function uuidLike(index) {
  return `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

test("runs every id exactly once, in batches under the URL limit", async () => {
  const ids = Array.from({ length: 633 }, (_, index) => uuidLike(index));
  const seenBatches = [];

  const { data, error } = await inBatches(ids, async (batch) => {
    seenBatches.push([...batch]);
    return { data: batch.map((id) => ({ id })), error: null };
  });

  assert.equal(error, null);
  assert.equal(data?.length, 633);
  assert.ok(seenBatches.length > 1, "large id lists must be split");
  for (const batch of seenBatches) {
    assert.ok(batch.length <= IN_BATCH_SIZE);
    // ~37 chars per UUID plus the `in.()` wrapper must stay under 8 KB.
    assert.ok(batch.join(",").length < 7000);
  }
  const returned = new Set((data || []).map((row) => row.id));
  for (const id of ids) assert.ok(returned.has(id));
});

test("dedupes ids and skips null/undefined entries", async () => {
  const seenBatches = [];

  const { data, error } = await inBatches(
    [uuidLike(1), null, uuidLike(1), undefined, uuidLike(2), ""],
    async (batch) => {
      seenBatches.push([...batch]);
      return { data: batch.map((id) => ({ id })), error: null };
    },
  );

  assert.equal(error, null);
  assert.equal(seenBatches.length, 1);
  assert.deepEqual(
    (data || []).map((row) => row.id).sort(),
    [uuidLike(1), uuidLike(2)].sort(),
  );
});

test("returns an empty result without calling the query for an empty list", async () => {
  let called = false;

  const { data, error } = await inBatches([], async () => {
    called = true;
    return { data: [], error: null };
  });

  assert.equal(called, false);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("reports the first batch error and drops partial rows", async () => {
  const failure = {
    message: "Bad Request",
    code: "400",
    details: "",
    hint: "",
  };

  const { data, error } = await inBatches(
    Array.from({ length: 250 }, (_, index) => uuidLike(index)),
    async (batch) =>
      batch[0] === uuidLike(200)
        ? { data: null, error: failure }
        : { data: batch.map((id) => ({ id })), error: null },
  );

  assert.equal(data, null);
  assert.equal(error, failure);
  assert.equal(error?.message, "Bad Request");
});
