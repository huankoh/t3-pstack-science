import { expect, test } from "bun:test";
import { sessionFixture } from "../tools/install/muse-output.mjs";

const unsupported = "Muse CLI output is not supported by this installer; update t3-pstack-science";
for (const source of [{ anyOf: {} }, { enum: [null] }, { $ref: 42 }]) {
  test(`unsupported hook schema ${JSON.stringify(source)} gets a named error`, () => {
    const schema = { $defs: { HookEventName: { enum: ["sessionStart"] }, HookTestFixture: { properties: { source } } } };
    expect(() => sessionFixture(schema, {}, "/tmp/fixture")).toThrow(unsupported);
  });
}

test("the fixture resolves source and matcher enum references from schema", () => {
  const schema = { $defs: {
    HookEventName: { enum: ["session_start"] },
    HookSource: { enum: ["resume"] },
    HookMatcher: { const: "resumed" },
    HookTestFixture: { properties: { source: { $ref: "#/$defs/HookSource" }, matcher_input: { $ref: "#/$defs/HookMatcher" } } },
  } };
  expect(sessionFixture(schema, {}, "/tmp/fixture")).toMatchObject({ event: "session_start", matcher_input: "resumed", stdin: { source: "resume" } });
});
