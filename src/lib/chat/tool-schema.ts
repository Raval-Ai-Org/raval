// Zod shape → the JSON Schema a model reads for a tool's input. Covers what
// the tool definitions use (src/server/mcp/tools, src/server/chat); anything
// else becomes "any", and the tool's own zod parse stays the real check.
import type { ZodRawShape, ZodTypeAny } from "zod";

type Json = Record<string, unknown>;

function describe(schema: ZodTypeAny, out: Json): Json {
  const text = schema.description;
  return text ? { ...out, description: text } : out;
}

function convert(schema: ZodTypeAny): { json: Json; optional: boolean } {
  const def = (schema as { _def: Record<string, unknown> })._def;
  const type = String(def.typeName ?? "");
  const inner = (value: unknown) => convert(value as ZodTypeAny);

  switch (type) {
    case "ZodOptional": {
      const r = inner(def.innerType);
      return { json: describe(schema, r.json), optional: true };
    }
    case "ZodDefault":
    case "ZodCatch": {
      const r = inner(def.innerType);
      return { json: describe(schema, r.json), optional: true };
    }
    case "ZodNullable": {
      const r = inner(def.innerType);
      return {
        json: describe(schema, { anyOf: [r.json, { type: "null" }] }),
        optional: r.optional,
      };
    }
    case "ZodEffects": {
      const r = inner(def.schema);
      return { json: describe(schema, r.json), optional: r.optional };
    }
    case "ZodBranded":
    case "ZodReadonly":
      return inner(def.type ?? def.innerType);
    case "ZodString": {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      const json: Json = { type: "string" };
      for (const c of checks) {
        if (c.kind === "uuid") json.format = "uuid";
        if (c.kind === "max" && typeof c.value === "number") json.maxLength = c.value;
        if (c.kind === "min" && typeof c.value === "number") json.minLength = c.value;
      }
      return { json: describe(schema, json), optional: false };
    }
    case "ZodNumber": {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      const json: Json = { type: checks.some((c) => c.kind === "int") ? "integer" : "number" };
      for (const c of checks) {
        if (c.kind === "min" && typeof c.value === "number") json.minimum = c.value;
        if (c.kind === "max" && typeof c.value === "number") json.maximum = c.value;
      }
      return { json: describe(schema, json), optional: false };
    }
    case "ZodBoolean":
      return { json: describe(schema, { type: "boolean" }), optional: false };
    case "ZodEnum":
      return {
        json: describe(schema, { type: "string", enum: [...(def.values as string[])] }),
        optional: false,
      };
    case "ZodNativeEnum":
      return {
        json: describe(schema, { enum: Object.values(def.values as Record<string, unknown>) }),
        optional: false,
      };
    case "ZodLiteral":
      return { json: describe(schema, { const: def.value }), optional: false };
    case "ZodArray": {
      const json: Json = { type: "array", items: inner(def.type).json };
      const min = (def.minLength as { value: number } | null)?.value;
      const max = (def.maxLength as { value: number } | null)?.value;
      if (typeof min === "number") json.minItems = min;
      if (typeof max === "number") json.maxItems = max;
      return { json: describe(schema, json), optional: false };
    }
    case "ZodObject": {
      const shape = (def.shape as () => ZodRawShape)();
      return { json: describe(schema, shapeToJsonSchema(shape)), optional: false };
    }
    case "ZodRecord":
      return {
        json: describe(schema, {
          type: "object",
          additionalProperties: inner(def.valueType).json,
        }),
        optional: false,
      };
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = [...((def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>) ?? [])].map(
        (o) => (Array.isArray(o) ? o[1] : o) as ZodTypeAny,
      );
      return {
        json: describe(schema, { anyOf: options.map((o) => convert(o).json) }),
        optional: false,
      };
    }
    default:
      return { json: describe(schema, {}), optional: type === "ZodUndefined" };
  }
}

/** An object schema for a tool's input, leaving out any `omit` keys. */
export function shapeToJsonSchema(shape: ZodRawShape, omit: readonly string[] = []): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    if (omit.includes(key)) continue;
    const { json, optional } = convert(schema);
    properties[key] = json;
    if (!optional) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}
