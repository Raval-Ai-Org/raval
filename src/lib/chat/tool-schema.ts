// Zod shape → the JSON Schema a model reads for a tool's input. Zod's own
// converter does the work; anything it can't express becomes "any", and the
// tool's own zod parse stays the real check.
import { z, type ZodRawShape } from "zod";

type Json = Record<string, unknown>;

/** An object schema for a tool's input, leaving out any `omit` keys. */
export function shapeToJsonSchema(shape: ZodRawShape, omit: readonly string[] = []): Json {
  const kept = Object.fromEntries(Object.entries(shape).filter(([key]) => !omit.includes(key)));
  // io: "input" describes what a caller sends, so fields with a default are optional.
  const { $schema: _schema, ...schema } = z.toJSONSchema(z.object(kept), {
    io: "input",
    unrepresentable: "any",
  }) as Json;
  return { ...(tidy(schema) as Json), additionalProperties: false };
}

// A model needs the shape, not zod's long uuid pattern or key-name constraint.
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (node && typeof node === "object") {
    const out = Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== "pattern" && key !== "propertyNames")
        .map(([key, value]) => [key, tidy(value)]),
    );
    // A nested object with named fields takes no others.
    if ("properties" in out && !("additionalProperties" in out)) out.additionalProperties = false;
    return out;
  }
  return node;
}
