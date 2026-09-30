const MAX_DEPTH = 64;

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("JSON string contains an unpaired surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("JSON string contains an unpaired surrogate");
    }
  }
}

function serialize(value: unknown, ancestors: Set<object>, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new TypeError("JSON document exceeds maximum nesting depth");
  }
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new TypeError("JSON number is not interoperable");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("Value is not JSON data");
  }
  if (ancestors.has(value)) {
    throw new TypeError("JSON document contains a cycle");
  }

  const isArray = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype) &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new TypeError("JSON document must use plain objects and arrays");
  }

  ancestors.add(value);
  try {
    if (isArray) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some((key) => typeof key === "symbol")
      ) {
        throw new TypeError("JSON array has holes or extra properties");
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("JSON array has holes or accessors");
        }
        items.push(serialize(descriptor.value, ancestors, depth + 1));
      }
      return `[${items.join(",")}]`;
    }

    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError("JSON object has symbol properties");
    }
    const fields = keys.map((key) => {
      const name = key as string;
      assertValidUnicode(name);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("JSON object has hidden or accessor properties");
      }
      return [name, descriptor.value] as const;
    });
    fields.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${fields
      .map(
        ([name, field]) =>
          `${JSON.stringify(name)}:${serialize(field, ancestors, depth + 1)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

// Serialize validated JSON values with sorted UTF-16 object keys and unchanged array order.
export function canonicalDocumentBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(serialize(value, new Set<object>(), 0));
}

// Hash the same bytes that are stored or published, rather than serializing twice.
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
