import { render, screen, fireEvent } from "@testing-library/react";
import { FindingsList } from "./FindingsList";
import type { DiffFinding } from "@shared/diff";

/**
 * Helper: Create a mock DiffFinding
 */
function createMockFinding(overrides?: Partial<DiffFinding>): DiffFinding {
  return {
    id: "finding-1",
    code: "STATUS_MISMATCH",
    category: "routing",
    severity: "critical",
    message: "HTTP status codes differ",
    left_value: 200,
    right_value: 404,
    ...overrides,
  };
}

describe("FindingsList", () => {
  describe("Grouping and Sorting", () => {
    it("renders without crash with empty findings", () => {
      render(<FindingsList findings={[]} />);
      expect(screen.getByText("No differences found")).toBeInTheDocument();
    });

    it("shows 'No differences found' when findings array is empty", () => {
      render(<FindingsList findings={[]} />);
      const noFindingsText = screen.getByText("No differences found");
      expect(noFindingsText).toBeInTheDocument();
    });

    it("groups findings by category dynamically", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
          code: "STATUS_MISMATCH",
        }),
        createMockFinding({
          id: "finding-2",
          category: "security",
          severity: "warn",
          code: "CORS_HEADER_DRIFT",
        }),
        createMockFinding({
          id: "finding-3",
          category: "cache",
          severity: "info",
          code: "CACHE_HEADER_DRIFT",
        }),
      ];

      render(<FindingsList findings={findings} />);

      // Verify category headers are present
      expect(screen.getByText("Routing")).toBeInTheDocument();
      expect(screen.getByText("Security")).toBeInTheDocument();
      expect(screen.getByText("Cache")).toBeInTheDocument();
    });

    it("sorts findings by severity within each category (critical > warn > info)", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "info",
          code: "FINAL_URL_MISMATCH",
          message: "Info level",
        }),
        createMockFinding({
          id: "finding-2",
          category: "routing",
          severity: "critical",
          code: "STATUS_MISMATCH",
          message: "Critical level",
        }),
        createMockFinding({
          id: "finding-3",
          category: "routing",
          severity: "warn",
          code: "REDIRECT_CHAIN_CHANGED",
          message: "Warn level",
        }),
      ];

      render(<FindingsList findings={findings} />);

      // Check rendering order by text content (critical should appear first)
      const messages = screen.getAllByText(/level/);
      expect(messages[0]).toHaveTextContent("Critical level");
      expect(messages[1]).toHaveTextContent("Warn level");
      expect(messages[2]).toHaveTextContent("Info level");
    });

    it("displays findings count badge per category", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
        createMockFinding({
          id: "finding-2",
          category: "routing",
          severity: "warn",
        }),
        createMockFinding({
          id: "finding-3",
          category: "security",
          severity: "info",
        }),
      ];

      render(<FindingsList findings={findings} />);

      // Routing should show count of 2, Security should show count of 1
      const routingHeader = screen.getByText("Routing").closest("button");
      const securityHeader = screen.getByText("Security").closest("button");

      expect(routingHeader).toHaveTextContent("2");
      expect(securityHeader).toHaveTextContent("1");
    });
  });

  describe("Expansion Behavior", () => {
    it("passes expandedId to child components correctly", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
      ];

      const { rerender } = render(
        <FindingsList findings={findings} expandedId={null} onExpandClick={jest.fn()} />
      );

      // Initially no expanded state
      let row = screen.getByText("STATUS_MISMATCH").closest("button");
      expect(row).not.toHaveClass("rowExpanded");

      // Rerender with expanded id
      rerender(
        <FindingsList findings={findings} expandedId="finding-1" onExpandClick={jest.fn()} />
      );

      row = screen.getByText("STATUS_MISMATCH").closest("button");
      expect(row).toHaveClass("rowExpanded");
    });

    it("calls onExpandClick when a finding is clicked", () => {
      const onExpandClick = jest.fn();

      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
      ];

      render(
        <FindingsList findings={findings} expandedId={null} onExpandClick={onExpandClick} />
      );

      const row = screen.getByText("STATUS_MISMATCH").closest("button");
      fireEvent.click(row!);

      expect(onExpandClick).toHaveBeenCalledWith("finding-1");
    });

    it("supports toggle behavior: clicking same finding collapses it", () => {
      const onExpandClick = jest.fn();

      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
      ];

      const { rerender } = render(
        <FindingsList findings={findings} expandedId={null} onExpandClick={onExpandClick} />
      );

      const row = screen.getByText("STATUS_MISMATCH").closest("button");

      // First click: expand
      fireEvent.click(row!);
      expect(onExpandClick).toHaveBeenCalledWith("finding-1");
      expect(row).not.toHaveClass("rowExpanded");

      // Re-render with expanded state (simulating parent's toggle logic)
      rerender(
        <FindingsList findings={findings} expandedId="finding-1" onExpandClick={onExpandClick} />
      );

      // Row should now show expanded state
      expect(row).toHaveClass("rowExpanded");

      // Second click: should request collapse (same ID)
      fireEvent.click(row!);
      expect(onExpandClick).toHaveBeenLastCalledWith("finding-1");
      // The parent's toggle handler would turn this into: prev === "finding-1" ? null : "finding-1"
    });

    it("toggles category collapse/expand on header click", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
      ];

      render(<FindingsList findings={findings} />);

      // Initially expanded (by default in CategoryGroup)
      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();

      // Click category header to collapse
      const routingHeader = screen.getByText("Routing");
      fireEvent.click(routingHeader);

      // Finding should be hidden
      expect(screen.queryByText("STATUS_MISMATCH")).not.toBeInTheDocument();

      // Click again to expand
      fireEvent.click(routingHeader);

      // Finding should be visible again
      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();
    });
  });

  describe("Category Headers", () => {
    it("displays all 7 category names", () => {
      const findings: DiffFinding[] = [
        createMockFinding({ id: "f1", category: "routing" }),
        createMockFinding({ id: "f2", category: "security" }),
        createMockFinding({ id: "f3", category: "cache" }),
        createMockFinding({ id: "f4", category: "content" }),
        createMockFinding({ id: "f5", category: "timing" }),
        createMockFinding({ id: "f6", category: "platform" }),
        createMockFinding({ id: "f7", category: "unknown" }),
      ];

      render(<FindingsList findings={findings} />);

      expect(screen.getByText("Routing")).toBeInTheDocument();
      expect(screen.getByText("Security")).toBeInTheDocument();
      expect(screen.getByText("Cache")).toBeInTheDocument();
      expect(screen.getByText("Content")).toBeInTheDocument();
      expect(screen.getByText("Timing")).toBeInTheDocument();
      expect(screen.getByText("Platform")).toBeInTheDocument();
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });

    it("only shows categories that have findings", () => {
      const findings: DiffFinding[] = [
        createMockFinding({ id: "f1", category: "routing" }),
        createMockFinding({ id: "f2", category: "security" }),
      ];

      render(<FindingsList findings={findings} />);

      expect(screen.getByText("Routing")).toBeInTheDocument();
      expect(screen.getByText("Security")).toBeInTheDocument();
      expect(screen.queryByText("Cache")).not.toBeInTheDocument();
      expect(screen.queryByText("Content")).not.toBeInTheDocument();
    });

    it("displays categories in correct order: routing, security, cache, content, timing, platform, unknown", () => {
      const findings: DiffFinding[] = [
        createMockFinding({ id: "f1", category: "unknown" }),
        createMockFinding({ id: "f2", category: "routing" }),
        createMockFinding({ id: "f3", category: "platform" }),
        createMockFinding({ id: "f4", category: "cache" }),
        createMockFinding({ id: "f5", category: "security" }),
        createMockFinding({ id: "f6", category: "timing" }),
        createMockFinding({ id: "f7", category: "content" }),
      ];

      render(<FindingsList findings={findings} />);

      const categoryHeaders = screen.getAllByText(
        /^(Routing|Security|Cache|Content|Timing|Platform|Unknown)$/
      );

      expect(categoryHeaders[0]).toHaveTextContent("Routing");
      expect(categoryHeaders[1]).toHaveTextContent("Security");
      expect(categoryHeaders[2]).toHaveTextContent("Cache");
      expect(categoryHeaders[3]).toHaveTextContent("Content");
      expect(categoryHeaders[4]).toHaveTextContent("Timing");
      expect(categoryHeaders[5]).toHaveTextContent("Platform");
      expect(categoryHeaders[6]).toHaveTextContent("Unknown");
    });
  });

  describe("Findings Rendering", () => {
    it("renders finding code and message for each finding", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          code: "STATUS_MISMATCH",
          message: "HTTP status codes differ",
        }),
        createMockFinding({
          id: "finding-2",
          category: "security",
          code: "CORS_HEADER_DRIFT",
          message: "CORS headers changed",
        }),
      ];

      render(<FindingsList findings={findings} />);

      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();
      expect(screen.getByText("HTTP status codes differ")).toBeInTheDocument();
      expect(screen.getByText("CORS_HEADER_DRIFT")).toBeInTheDocument();
      expect(screen.getByText("CORS headers changed")).toBeInTheDocument();
    });

    it("renders severity badges for each finding", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "finding-1",
          category: "routing",
          severity: "critical",
        }),
      ];

      render(<FindingsList findings={findings} />);

      // SeverityBadge renders emoji + text
      expect(screen.getByText("🔴 Critical")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("handles multiple findings in same category and severity", () => {
      const findings: DiffFinding[] = [
        createMockFinding({
          id: "f1",
          category: "routing",
          severity: "critical",
          code: "STATUS_MISMATCH",
          message: "First critical",
        }),
        createMockFinding({
          id: "f2",
          category: "routing",
          severity: "critical",
          code: "FINAL_URL_MISMATCH",
          message: "Second critical",
        }),
      ];

      render(<FindingsList findings={findings} />);

      expect(screen.getByText("First critical")).toBeInTheDocument();
      expect(screen.getByText("Second critical")).toBeInTheDocument();
      const routingHeader = screen.getByText("Routing").closest("button");
      expect(routingHeader).toHaveTextContent("2");
    });

    it("handles all findings in one category", () => {
      const findings: DiffFinding[] = [
        createMockFinding({ id: "f1", category: "security" }),
        createMockFinding({ id: "f2", category: "security" }),
        createMockFinding({ id: "f3", category: "security" }),
      ];

      render(<FindingsList findings={findings} />);

      const securityHeader = screen.getByText("Security").closest("button");
      expect(securityHeader).toHaveTextContent("3");
      expect(screen.queryByText("Routing")).not.toBeInTheDocument();
    });

    it("handles single finding", () => {
      const findings: DiffFinding[] = [createMockFinding({ id: "f1", category: "cache" })];

      render(<FindingsList findings={findings} />);

      expect(screen.getByText("STATUS_MISMATCH")).toBeInTheDocument();
      const cacheHeader = screen.getByText("Cache").closest("button");
      expect(cacheHeader).toHaveTextContent("1");
    });
  });
});
