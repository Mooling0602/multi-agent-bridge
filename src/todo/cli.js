/**
 * Parse CLI arguments into a command object.
 *
 * Supported commands:
 *   add <title>   - create a new TODO item
 *   list          - list all TODO items
 *   done <id>     - toggle the done flag of an item
 *   rm <id>       - remove an item
 *
 * @param {string[]} args process.argv slice (excluding node and script)
 * @returns {{command: string, args: string[]}}
 */
export function parseArgs(args) {
  const [command, ...rest] = args;
  if (!command) {
    throw new Error("Missing command. Usage: todo <add|list|done|rm> [args]");
  }
  return { command, args: rest };
}
