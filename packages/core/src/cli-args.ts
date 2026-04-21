/**
 * CLI argument parsing utilities for consistent --arg and --arg=value handling.
 */

/**
 * Parse a string argument that supports both formats:
 * - Space-separated: --arg value
 * - Equals-separated: --arg=value
 *
 * Returns the parsed value and the new index (or null if the argument didn't match).
 */
export function parseStringArg(
  args: string[],
  index: number,
  prefix: string,
): { value: string; newIndex: number } | null {
  const arg = args[index];

  if (arg === undefined) {
    return null;
  }

  // Equals format: --arg=value
  if (arg.startsWith(`${prefix}=`)) {
    const value = arg.slice(prefix.length + 1);
    return { value, newIndex: index };
  }

  // Space-separated format: --arg value
  if (arg === prefix) {
    const value = args[index + 1];

    if (value === undefined) {
      throw new Error(`${prefix} requires a value.`);
    }

    return { value, newIndex: index + 1 };
  }

  return null;
}

/**
 * Parse a numeric argument that supports both formats:
 * - Space-separated: --arg 42
 * - Equals-separated: --arg=42
 *
 * Validates that the value is a finite number and passes optional validation.
 *
 * Returns the parsed number and the new index (or null if the argument didn't match).
 */
export function parseNumberArg(
  args: string[],
  index: number,
  prefix: string,
  validate?: (value: number) => string | null,
): { value: number; newIndex: number } | null {
  const arg = args[index];

  if (arg === undefined) {
    return null;
  }

  let rawValue: string;
  let newIndex: number;

  // Equals format: --arg=42
  if (arg.startsWith(`${prefix}=`)) {
    rawValue = arg.slice(prefix.length + 1);
    newIndex = index;
  } else if (arg === prefix) {
    // Space-separated format: --arg 42
    const nextArg = args[index + 1];

    if (nextArg === undefined) {
      throw new Error(`${prefix} requires a value.`);
    }

    rawValue = nextArg;
    newIndex = index + 1;
  } else {
    return null;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`${prefix} must be a number.`);
  }

  if (validate) {
    const error = validate(value);

    if (error) {
      throw new Error(error);
    }
  }

  return { value, newIndex };
}

/**
 * Parse an integer argument that supports both formats.
 *
 * Validates that the value is an integer and passes optional validation.
 */
export function parseIntegerArg(
  args: string[],
  index: number,
  prefix: string,
  validate?: (value: number) => string | null,
): { value: number; newIndex: number } | null {
  return parseNumberArg(args, index, prefix, (value) => {
    if (!Number.isInteger(value)) {
      return `${prefix} must be an integer.`;
    }

    return validate?.(value) ?? null;
  });
}

/**
 * Check if an argument is a flag (no value) like --help or -h.
 */
export function isFlagArg(arg: string, ...flags: string[]): boolean {
  return flags.includes(arg);
}
