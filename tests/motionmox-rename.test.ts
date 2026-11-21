import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without types
import { renameText } from "../scripts/motionmox/rename.mjs";

describe("MotionMox rename", () => {
  it("renames module names, not plain strings", () => {
    const src = [
      "import {useCurrentFrame} from 'remotion';",
      "import {fade} from '@remotion/transitions/fade';",
      "const v = require('remotion/version');",
      'export * from "remotion/no-react";',
      "const bin = path.resolve(base, 'remotion');",
      "const args = ['-i', 'remotion'];",
      "process.env.REMOTION_TOKEN;",
      "Run npx remotion render in remotion.config.ts.",
    ].join("\n");
    const out = renameText(src).split("\n");
    expect(out[0]).toBe("import {useCurrentFrame} from '@motionmox/core';");
    expect(out[1]).toBe("import {fade} from '@motionmox/transitions/fade';");
    expect(out[2]).toBe("const v = require('@motionmox/core/version');");
    expect(out[3]).toBe('export * from "@motionmox/core/no-react";');
    expect(out[4]).toBe("const bin = path.resolve(base, 'remotion');");
    expect(out[5]).toBe("const args = ['-i', 'remotion'];");
    expect(out[6]).toBe("process.env.MOTIONMOX_TOKEN;");
    expect(out[7]).toBe("Run npx motionmox render in motionmox.config.ts.");
  });

  it("renames package names in JSON", () => {
    const json =
      '{"name": "remotion", "dependencies": {"@remotion/renderer": "workspace:*", "remotion": "workspace:*"}}';
    expect(renameText(json, { isJson: true })).toBe(
      '{"name": "@motionmox/core", "dependencies": {"@motionmox/renderer": "workspace:*", "@motionmox/core": "workspace:*"}}',
    );
  });

  it("renames the product word but never the licence or the credit", () => {
    const src = [
      "Check that all your Remotion packages match.",
      "Copyright © 2026 Remotion",
      "See the Remotion License at https://remotion.dev/license",
      "getRemotionEnvironment()",
    ].join("\n");
    const out = renameText(src).split("\n");
    expect(out[0]).toBe("Check that all your MotionMox packages match.");
    expect(out[1]).toBe("Copyright © 2026 Remotion");
    expect(out[2]).toBe("See the Remotion License at https://remotion.dev/license");
    expect(out[3]).toBe("getRemotionEnvironment()");
  });

  it("is idempotent", () => {
    const once = renameText("import x from 'remotion'; Remotion");
    expect(renameText(once)).toBe(once);
  });
});
