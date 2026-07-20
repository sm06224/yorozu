import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("App がヘッダを描画する", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "YOROZU" })).toBeDefined();
});
