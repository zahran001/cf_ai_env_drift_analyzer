import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { LlmExplanation, RankedCause, RecommendedAction } from "@shared/llm";
import { ExplanationPanel } from "./ExplanationPanel";

/**
 * Test Helper: Create a mock LlmExplanation with default values
 */
function createMockExplanation(overrides?: Partial<LlmExplanation>): LlmExplanation {
  return {
    summary: "Both environments have different CORS configurations.",
    ranked_causes: [
      {
        cause: "CORS policy misconfiguration",
        confidence: 0.95,
        evidence: [
          "Left environment allows all origins (*)",
          "Right environment restricts to specific origins",
        ],
      } as RankedCause,
      {
        cause: "Missing security headers",
        confidence: 0.75,
        evidence: ["Right environment lacks X-Frame-Options header"],
      } as RankedCause,
    ],
    actions: [
      {
        action: "Align CORS policies between environments",
        why: "Ensures consistent behavior across deployments.",
      } as RecommendedAction,
      {
        action: "Add missing security headers to left environment",
        why: "Improves security posture to match right environment.",
      } as RecommendedAction,
    ],
    notes: ["Based on deterministic diff analysis", "No speculative reasoning"],
    ...overrides,
  };
}

describe("ExplanationPanel", () => {
  // ✅ Test 1: Renders without crash with valid explanation
  it("renders without crash with valid explanation", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  // ✅ Test 2: Shows "Explanation unavailable" when null
  it("shows 'Explanation unavailable' when explanation is null", () => {
    render(<ExplanationPanel explanation={null} />);
    expect(screen.getByText("Explanation unavailable")).toBeInTheDocument();
  });

  // ✅ Test 3: Shows "Explanation unavailable" when undefined
  it("shows 'Explanation unavailable' when explanation is undefined", () => {
    render(<ExplanationPanel />);
    expect(screen.getByText("Explanation unavailable")).toBeInTheDocument();
  });

  // ✅ Test 4: Displays summary text
  it("displays summary text", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);
    expect(
      screen.getByText("Both environments have different CORS configurations.")
    ).toBeInTheDocument();
  });

  // ✅ Test 5: Displays ranked causes section with count
  it("displays ranked causes section with count", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);
    expect(screen.getByText(/Ranked Causes \(2\)/)).toBeInTheDocument();
  });

  // ✅ Test 6: Displays recommended actions section with count
  it("displays recommended actions section with count", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);
    expect(screen.getByText(/Recommended Actions \(2\)/)).toBeInTheDocument();
  });

  // ✅ Test 7: Ranked causes section is collapsible
  it("ranked causes section is collapsible", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    const causesHeader = screen.getByText(/Ranked Causes/);
    expect(
      screen.queryByText("CORS policy misconfiguration")
    ).not.toBeInTheDocument();

    fireEvent.click(causesHeader);
    expect(screen.getByText("CORS policy misconfiguration")).toBeInTheDocument();

    fireEvent.click(causesHeader);
    expect(
      screen.queryByText("CORS policy misconfiguration")
    ).not.toBeInTheDocument();
  });

  // ✅ Test 8: Actions section is collapsible
  it("actions section is collapsible", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    const actionsHeader = screen.getByText(/Recommended Actions/);
    expect(
      screen.queryByText("Align CORS policies between environments")
    ).not.toBeInTheDocument();

    fireEvent.click(actionsHeader);
    expect(
      screen.getByText("Align CORS policies between environments")
    ).toBeInTheDocument();

    fireEvent.click(actionsHeader);
    expect(
      screen.queryByText("Align CORS policies between environments")
    ).not.toBeInTheDocument();
  });

  // ✅ Test 9: Displays all causes when expanded
  it("displays all causes when expanded", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    fireEvent.click(screen.getByText(/Ranked Causes/));

    expect(screen.getByText("CORS policy misconfiguration")).toBeInTheDocument();
    expect(screen.getByText("Missing security headers")).toBeInTheDocument();
  });

  // ✅ Test 10: Displays all actions when expanded
  it("displays all actions when expanded", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    fireEvent.click(screen.getByText(/Recommended Actions/));

    expect(
      screen.getByText("Align CORS policies between environments")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add missing security headers to left environment")
    ).toBeInTheDocument();
  });

  // ✅ Test 11: Displays evidence in causes
  it("displays evidence in causes when expanded", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    fireEvent.click(screen.getByText(/Ranked Causes/));

    expect(
      screen.getByText("Left environment allows all origins (*)")
    ).toBeInTheDocument();
  });

  // ✅ Test 12: Displays notes section when present
  it("displays notes section when present", () => {
    const explanation = createMockExplanation();
    render(<ExplanationPanel explanation={explanation} />);

    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(
      screen.getByText("Based on deterministic diff analysis")
    ).toBeInTheDocument();
  });

  // ✅ Test 13: Handles empty actions array gracefully
  it("handles empty actions array gracefully", () => {
    const explanation = createMockExplanation({ actions: [] });
    render(<ExplanationPanel explanation={explanation} />);

    expect(screen.getByText(/Recommended Actions/)).toBeInTheDocument();
  });

  // ✅ Test 14: Handles empty causes array gracefully
  it("handles empty causes array gracefully", () => {
    const explanation = createMockExplanation({ ranked_causes: [] });
    render(<ExplanationPanel explanation={explanation} />);

    // Should not render causes section if array is empty
    expect(screen.queryByText(/Ranked Causes/)).not.toBeInTheDocument();
  });

  // ✅ Test 15: Confidence displayed as percentage
  it("confidence displayed as percentage when expanded", () => {
    const explanation = createMockExplanation({
      ranked_causes: [
        {
          cause: "Test cause",
          confidence: 0.85,
          evidence: [],
        } as RankedCause,
      ],
    });
    render(<ExplanationPanel explanation={explanation} />);

    fireEvent.click(screen.getByText(/Ranked Causes/));

    // ConfidenceBar should display "85%"
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  // ✅ Test 16: Handles undefined notes gracefully
  it("handles undefined notes gracefully", () => {
    const explanation = createMockExplanation({ notes: undefined });
    render(<ExplanationPanel explanation={explanation} />);

    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  // ✅ Test 17: Snapshot test with full explanation
  it("matches snapshot with full explanation", () => {
    const explanation = createMockExplanation();
    const { container } = render(
      <ExplanationPanel explanation={explanation} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  // ✅ Test 18: Snapshot test with null explanation
  it("matches snapshot with null explanation", () => {
    const { container } = render(<ExplanationPanel explanation={null} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  // ✅ Test 19: Snapshot test with no actions
  it("matches snapshot with no actions", () => {
    const explanation = createMockExplanation({ actions: [] });
    const { container } = render(
      <ExplanationPanel explanation={explanation} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
