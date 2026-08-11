#!/usr/bin/env node
import { createStore } from "./store.js";
import { createService } from "./service.js";
import { parseArgs } from "./cli.js";

const store = createStore();
const service = createService(store);

function formatItem(item, index) {
  const status = item.done ? "[x]" : "[ ]";
  return `${index + 1}. ${status} ${item.title} (${item.id})`;
}

async function run(command, args) {
  switch (command) {
    case "add": {
      const title = args.join(" ").trim();
      const item = await service.create(title);
      console.log(`Added: "${item.title}" (${item.id})`);
      return;
    }
    case "list": {
      const items = await service.list();
      if (items.length === 0) {
        console.log("No TODO items.");
        return;
      }
      for (const [index, item] of items.entries()) {
        console.log(formatItem(item, index));
      }
      return;
    }
    case "done": {
      const [id] = args;
      const item = await service.toggle(id);
      console.log(`Updated: "${item.title}" -> ${item.done ? "done" : "not done"} (${item.id})`);
      return;
    }
    case "rm": {
      const [id] = args;
      const item = await service.remove(id);
      console.log(`Removed: "${item.title}" (${item.id})`);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}. Usage: todo <add|list|done|rm>`);
  }
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  await run(command, args);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
