import { getHeuristicProgress } from "./heuristic";

describe("getHeuristicProgress", () => {
  test("returns 'Initializing comparison…' for elapsed < 2000ms", () => {
    expect(getHeuristicProgress(0)).toBe("Initializing comparison…");
    expect(getHeuristicProgress(500)).toBe("Initializing comparison…");
    expect(getHeuristicProgress(1500)).toBe("Initializing comparison…");
    expect(getHeuristicProgress(1999)).toBe("Initializing comparison…");
  });

  test("returns 'Probing environments…' for 2000ms <= elapsed < 5000ms", () => {
    expect(getHeuristicProgress(2000)).toBe("Probing environments…");
    expect(getHeuristicProgress(3000)).toBe("Probing environments…");
    expect(getHeuristicProgress(4500)).toBe("Probing environments…");
    expect(getHeuristicProgress(4999)).toBe("Probing environments…");
  });

  test("returns 'Analyzing drift & generating explanation…' for 5000ms <= elapsed < 8000ms", () => {
    expect(getHeuristicProgress(5000)).toBe(
      "Analyzing drift & generating explanation…"
    );
    expect(getHeuristicProgress(6000)).toBe(
      "Analyzing drift & generating explanation…"
    );
    expect(getHeuristicProgress(7500)).toBe(
      "Analyzing drift & generating explanation…"
    );
    expect(getHeuristicProgress(7999)).toBe(
      "Analyzing drift & generating explanation…"
    );
  });

  test("returns 'Processing…' for 8000ms <= elapsed <= 10000ms", () => {
    expect(getHeuristicProgress(8000)).toBe("Processing…");
    expect(getHeuristicProgress(9000)).toBe("Processing…");
    expect(getHeuristicProgress(10000)).toBe("Processing…");
  });

  test("returns 'Taking longer than usual…' for elapsed > 10000ms", () => {
    expect(getHeuristicProgress(10001)).toBe("Taking longer than usual…");
    expect(getHeuristicProgress(15000)).toBe("Taking longer than usual…");
    expect(getHeuristicProgress(30000)).toBe("Taking longer than usual…");
  });
});
