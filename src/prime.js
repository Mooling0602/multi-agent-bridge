/**
 * Checks whether a given number is prime.
 * @param {number} n - The number to test. Must be an integer.
 * @returns {boolean} Whether n is prime.
 *   Returns false for n < 2.
 *   Throws a TypeError if n is not an integer.
 */
export function isPrime(n) {
  if (!Number.isInteger(n)) {
    throw new TypeError("Input must be an integer");
  }
  if (n < 2) return false;
  if (n === 2 || n === 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;

  const limit = Math.sqrt(n);
  for (let i = 5; i <= limit; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}
