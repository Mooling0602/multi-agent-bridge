import { randomUUID } from "node:crypto";

const MAX_TITLE_LENGTH = 200;

/**
 * Business logic layer for the TODO app.
 *
 * Validates input, generates ids, and delegates persistence to the store.
 * @param {ReturnType<import("./store.js").createStore>} store
 */
export function createService(store) {
  function assertId(id) {
    if (!id) {
      throw new Error("Missing id");
    }
  }

  return {
    /** @returns {Promise<Array<object>>} */
    async list() {
      return store.list();
    },

    /**
     * Create a TODO item.
     * @param {string} title
     * @returns {Promise<object>}
     */
    async create(title) {
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error("Title must be a non-empty string");
      }
      const trimmed = title.trim();
      if (trimmed.length > MAX_TITLE_LENGTH) {
        throw new Error(`Title must be at most ${MAX_TITLE_LENGTH} characters`);
      }
      return store.create({
        id: randomUUID(),
        title: trimmed,
        done: false,
        createdAt: new Date().toISOString(),
      });
    },

    /**
     * Toggle the done flag of an item.
     * @param {string} id
     * @returns {Promise<object>}
     */
    async toggle(id) {
      assertId(id);
      const item = await store.toggle(id);
      if (!item) {
        throw new Error(`TODO item not found: ${id}`);
      }
      return item;
    },

    /**
     * Remove an item.
     * @param {string} id
     * @returns {Promise<object>}
     */
    async remove(id) {
      assertId(id);
      const item = await store.remove(id);
      if (!item) {
        throw new Error(`TODO item not found: ${id}`);
      }
      return item;
    },
  };
}
