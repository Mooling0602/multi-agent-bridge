/**
 * In-memory store for TODO items.
 *
 * Holds an array of `{ id, title, done, createdAt }` records and exposes
 * CRUD-style operations. There is no persistence: data lives only for the
 * lifetime of the process.
 */

export function createStore() {
  const items = [];

  return {
    /** @returns {Array<{id: string, title: string, done: boolean, createdAt: string}>} */
    list() {
      return items.slice();
    },

    /**
     * Append an item.
     * @param {{id: string, title: string, done: boolean, createdAt: string}} item
     * @returns {Promise<object>} the stored item
     */
    async create(item) {
      items.push(item);
      return item;
    },

    /**
     * Toggle the done flag of an item by id.
     * @param {string} id
     * @returns {Promise<object|null>} the updated item, or null if not found
     */
    async toggle(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      item.done = !item.done;
      return item;
    },

    /**
     * Remove an item by id.
     * @param {string} id
     * @returns {Promise<object|null>} the removed item, or null if not found
     */
    async remove(id) {
      const index = items.findIndex((entry) => entry.id === id);
      if (index === -1) return null;
      const [removed] = items.splice(index, 1);
      return removed;
    },
  };
}
