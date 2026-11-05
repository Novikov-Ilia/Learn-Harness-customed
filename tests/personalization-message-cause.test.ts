import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeInputCause, type LhMarkerMessage } from "../src/core/native-messages.ts";

for (const customType of ["child-learning-note", "learning-block-scope"] as const) {
	test(`${customType} is context, not an unauthorized background subscription request`, () => {
		const marker: LhMarkerMessage = { id: "context", role: "custom", customType, content: "Saved context", details: {}, display: false, timestamp: 1 };
		assert.equal(nativeInputCause(marker, [marker]), "neutral");
	});
}
