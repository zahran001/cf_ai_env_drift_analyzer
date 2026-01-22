// shared/json.ts - Define a local “JSON-safe” alias for JSON-compatible data structures

/**
 * Primitive JSON value types.
 */

export type JsonPrimitive = string | number | boolean | null;

export type Json =
  | JsonPrimitive
  | { [key: string]: Json }
  | Json[];
