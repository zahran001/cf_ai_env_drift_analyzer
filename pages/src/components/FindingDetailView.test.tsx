import { render, screen, fireEvent } from "@testing-library/react";
import type { DiffFinding, DiffEvidence } from "@shared/diff";
import { FindingDetailView } from "./FindingDetailView";

/**
 * Test helper: Create a mock DiffFinding with defaults
 */
function createMockFinding(overrides?: Partial<DiffFinding>): DiffFinding {
  return {
    id: "test-finding-1",
    code: "STATUS_MISMATCH",
    category: "routing",
    severity: "critical",
    message: "Test finding message",
    ...overrides,
  };
}

describe("FindingDetailView", () => {
  describe("Rendering", () => {
    it("renders without crash with valid finding", () => {
      const finding = createMockFinding();
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();
      expect(screen.getByText("Test finding message")).toBeInTheDocument();
    });

    it("displays finding code and category", () => {
      const finding = createMockFinding();
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();
      expect(screen.getByText("routing")).toBeInTheDocument();
    });

    it("displays message text", () => {
      const finding = createMockFinding({
        message: "Custom message for this finding",
      });
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("Custom message for this finding")).toBeInTheDocument();
    });

    it("renders severity badge", () => {
      const finding = createMockFinding({ severity: "critical" });
      render(<FindingDetailView finding={finding} />);

      // SeverityBadge renders with emoji and text
      expect(screen.getByText(/🔴|Critical/)).toBeInTheDocument();
    });
  });

  describe("Graceful Degradation", () => {
    it("shows evidence list when evidence array is present", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["cache-control"], note: "value changed" },
      ];
      const finding = createMockFinding({ evidence });
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("headers")).toBeInTheDocument();
      expect(screen.getByText("cache-control")).toBeInTheDocument();
    });

    it("shows value comparison when left_value present (no evidence)", () => {
      const finding = createMockFinding({
        evidence: undefined,
        left_value: "200",
        right_value: "404",
      });
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("Left")).toBeInTheDocument();
      expect(screen.getByText("Right")).toBeInTheDocument();
    });

    it("shows raw JSON fallback when no evidence or values", () => {
      const finding = createMockFinding({
        evidence: undefined,
        left_value: undefined,
        right_value: undefined,
      });
      render(<FindingDetailView finding={finding} />);

      // RawJSON component should render the finding data
      expect(screen.getByText(/test-finding-1/)).toBeInTheDocument();
    });

    it("prioritizes evidence over values", () => {
      const evidence: DiffEvidence[] = [
        { section: "headers", keys: ["content-type"] },
      ];
      const finding = createMockFinding({
        evidence,
        left_value: { type: "text/html" },
        right_value: { type: "application/json" },
      });
      render(<FindingDetailView finding={finding} />);

      // Should show evidence, not values
      expect(screen.getByText("headers")).toBeInTheDocument();
      expect(screen.queryByText("Left")).not.toBeInTheDocument();
    });
  });

  describe("Recommendations Section", () => {
    it("shows recommendations when present", () => {
      const finding = createMockFinding({
        recommendations: [
          "Update cache-control header",
          "Review cache policy",
        ],
      });
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("Recommendations")).toBeInTheDocument();
      expect(screen.getByText("Update cache-control header")).toBeInTheDocument();
      expect(screen.getByText("Review cache policy")).toBeInTheDocument();
    });

    it("hides recommendations section when not present", () => {
      const finding = createMockFinding({ recommendations: undefined });
      render(<FindingDetailView finding={finding} />);

      expect(screen.queryByText("Recommendations")).not.toBeInTheDocument();
    });

    it("hides empty recommendations array", () => {
      const finding = createMockFinding({ recommendations: [] });
      render(<FindingDetailView finding={finding} />);

      expect(screen.queryByText("Recommendations")).not.toBeInTheDocument();
    });
  });

  describe("Close Button", () => {
    it("renders close button when onClose callback provided", () => {
      const onClose = jest.fn();
      const finding = createMockFinding();
      render(<FindingDetailView finding={finding} onClose={onClose} />);

      const closeButton = screen.getByText("✕");
      expect(closeButton).toBeInTheDocument();
    });

    it("calls onClose when close button clicked", () => {
      const onClose = jest.fn();
      const finding = createMockFinding();
      render(<FindingDetailView finding={finding} onClose={onClose} />);

      const closeButton = screen.getByText("✕");
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not render close button when onClose not provided", () => {
      const finding = createMockFinding();
      render(<FindingDetailView finding={finding} />);

      expect(screen.queryByText("✕")).not.toBeInTheDocument();
    });
  });

  describe("Snapshots", () => {
    it("matches snapshot with evidence", () => {
      const evidence: DiffEvidence[] = [
        {
          section: "headers",
          keys: ["cache-control", "vary"],
          note: "value changed",
        },
      ];
      const finding = createMockFinding({ evidence });
      const { container } = render(
        <FindingDetailView finding={finding} />
      );

      expect(container.firstChild).toMatchSnapshot();
    });

    it("matches snapshot with values only", () => {
      const finding = createMockFinding({
        evidence: undefined,
        left_value: { status: 200 },
        right_value: { status: 404 },
        recommendations: ["Check redirect configuration"],
      });
      const { container } = render(
        <FindingDetailView finding={finding} />
      );

      expect(container.firstChild).toMatchSnapshot();
    });

    it("matches snapshot with raw JSON fallback", () => {
      const finding = createMockFinding({
        evidence: undefined,
        left_value: undefined,
        right_value: undefined,
      });
      const { container } = render(
        <FindingDetailView finding={finding} />
      );

      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe("Edge Cases", () => {
    it("handles finding with all optional fields undefined", () => {
      const finding: DiffFinding = {
        id: "minimal",
        code: "UNKNOWN_DRIFT",
        category: "unknown",
        severity: "info",
        message: "Minimal finding",
      };
      render(<FindingDetailView finding={finding} />);

      expect(screen.getByText("UNKNOWN_DRIFT")).toBeInTheDocument();
      expect(screen.getByText("Minimal finding")).toBeInTheDocument();
    });

    it("handles empty evidence array as undefined", () => {
      const finding = createMockFinding({
        evidence: [],
        left_value: "test",
        right_value: "test",
      });
      render(<FindingDetailView finding={finding} />);

      // Empty array should be treated as falsy, fall through to values
      expect(screen.getByText("Left")).toBeInTheDocument();
    });
  });
});
