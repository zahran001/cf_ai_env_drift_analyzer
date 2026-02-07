import { render, screen, fireEvent } from "@testing-library/react";
import type { SignalEnvelope, EnvDiff } from "@shared/diff";
import { RawDataView } from "./RawDataView";

/**
 * Test helper: Create mock SignalEnvelope with defaults
 */
function createMockSignalEnvelope(
  overrides?: Partial<SignalEnvelope>
): SignalEnvelope {
  return {
    schemaVersion: 1,
    comparisonId: "comp-1",
    probeId: "probe-1",
    side: "left",
    requestedUrl: "https://example.com",
    capturedAt: new Date().toISOString(),
    result: {
      ok: true,
      response: {
        status: 200,
        finalUrl: "https://example.com",
        headers: {
          core: {},
        },
      },
      durationMs: 100,
    },
    ...overrides,
  };
}

/**
 * Test helper: Create mock EnvDiff with defaults
 */
function createMockEnvDiff(overrides?: Partial<EnvDiff>): EnvDiff {
  return {
    schemaVersion: 1,
    comparisonId: "comp-1",
    leftProbeId: "probe-left",
    rightProbeId: "probe-right",
    probe: {
      leftOk: true,
      rightOk: true,
      outcomeChanged: false,
      responsePresent: true,
    },
    timing: {
      deltaMs: 0,
    },
    findings: [],
    maxSeverity: "info",
    ...overrides,
  };
}

describe("RawDataView", () => {
  describe("Rendering", () => {
    it("renders without crash with all data", () => {
      const left = createMockSignalEnvelope();
      const right = createMockSignalEnvelope();
      const diff = createMockEnvDiff();

      render(<RawDataView left={left} right={right} diff={diff} />);

      expect(screen.getByText("Raw Data")).toBeInTheDocument();
      expect(screen.getByText("Left Probe Data")).toBeInTheDocument();
      expect(screen.getByText("Right Probe Data")).toBeInTheDocument();
      expect(screen.getByText("Diff Output")).toBeInTheDocument();
    });

    it("returns null when all data is undefined", () => {
      const { container } = render(<RawDataView />);

      expect(container.firstChild).toBeNull();
    });

    it("renders only present data sections", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      expect(screen.getByText("Raw Data")).toBeInTheDocument();
      expect(screen.getByText("Left Probe Data")).toBeInTheDocument();
      expect(screen.queryByText("Right Probe Data")).not.toBeInTheDocument();
      expect(screen.queryByText("Diff Output")).not.toBeInTheDocument();
    });

    it("renders only right when only right provided", () => {
      const right = createMockSignalEnvelope();
      render(<RawDataView right={right} />);

      expect(screen.getByText("Raw Data")).toBeInTheDocument();
      expect(screen.getByText("Right Probe Data")).toBeInTheDocument();
      expect(screen.queryByText("Left Probe Data")).not.toBeInTheDocument();
      expect(screen.queryByText("Diff Output")).not.toBeInTheDocument();
    });

    it("renders only diff when only diff provided", () => {
      const diff = createMockEnvDiff();
      render(<RawDataView diff={diff} />);

      expect(screen.getByText("Raw Data")).toBeInTheDocument();
      expect(screen.getByText("Diff Output")).toBeInTheDocument();
      expect(screen.queryByText("Left Probe Data")).not.toBeInTheDocument();
      expect(screen.queryByText("Right Probe Data")).not.toBeInTheDocument();
    });
  });

  describe("Collapsible Behavior", () => {
    it("sections start collapsed", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      // Headers should exist and have aria-expanded=false (not expanded initially)
      const headers = screen.getAllByRole("button");
      const leftHeader = headers.find((h) => h.textContent.includes("Left"));
      expect(leftHeader).toHaveAttribute("aria-expanded", "false");
    });

    it("expands section on toggle button click", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      const leftHeader = screen.getByText("Left Probe Data").closest("button");
      expect(leftHeader).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(leftHeader!);

      expect(leftHeader).toHaveAttribute("aria-expanded", "true");
    });

    it("collapses section on second toggle click", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      const leftHeader = screen.getByText("Left Probe Data").closest("button");

      // Expand
      fireEvent.click(leftHeader!);
      expect(leftHeader).toHaveAttribute("aria-expanded", "true");

      // Collapse
      fireEvent.click(leftHeader!);
      expect(leftHeader).toHaveAttribute("aria-expanded", "false");
    });

    it("sections expand/collapse independently", () => {
      const left = createMockSignalEnvelope();
      const right = createMockSignalEnvelope();
      render(<RawDataView left={left} right={right} />);

      const buttons = screen.getAllByRole("button").filter(
        (b) => b.textContent.includes("Left") || b.textContent.includes("Right")
      );
      const leftButton = buttons.find((b) => b.textContent.includes("Left"));
      const rightButton = buttons.find((b) => b.textContent.includes("Right"));

      // Expand left
      fireEvent.click(leftButton!);
      expect(leftButton).toHaveAttribute("aria-expanded", "true");
      expect(rightButton).toHaveAttribute("aria-expanded", "false");

      // Expand right
      fireEvent.click(rightButton!);
      expect(leftButton).toHaveAttribute("aria-expanded", "true");
      expect(rightButton).toHaveAttribute("aria-expanded", "true");
    });

    it("toggle icons change when expanding/collapsing", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      const header = screen.getByText("Left Probe Data").closest("button");
      const icon = header?.querySelector(".toggleIcon");

      expect(icon?.textContent).toBe("▶");

      fireEvent.click(header!);

      expect(icon?.textContent).toBe("▼");
    });
  });

  describe("Copy Button", () => {
    it("renders copy button on each section", () => {
      const left = createMockSignalEnvelope();
      const right = createMockSignalEnvelope();
      render(<RawDataView left={left} right={right} />);

      const copyButtons = screen.getAllByText("Copy");
      expect(copyButtons.length).toBe(2);
    });

    it("copy button is accessible alongside toggle button", () => {
      const left = createMockSignalEnvelope();
      render(<RawDataView left={left} />);

      const headerButton = screen.getByText("Left Probe Data").closest("button");
      expect(headerButton).toHaveAttribute("aria-expanded", "false");

      // Verify copy button exists (MVP: functional in Phase 4)
      const copyButtons = screen.getAllByText("Copy");
      expect(copyButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Snapshots", () => {
    it("matches snapshot with all sections present", () => {
      const left = createMockSignalEnvelope();
      const right = createMockSignalEnvelope();
      const diff = createMockEnvDiff({ findings: [] });

      const { container } = render(
        <RawDataView left={left} right={right} diff={diff} />
      );

      expect(container.firstChild).toMatchSnapshot();
    });

    it("matches snapshot with only diff", () => {
      const diff = createMockEnvDiff({
        findings: [
          {
            id: "finding-1",
            code: "STATUS_MISMATCH",
            category: "routing",
            severity: "critical",
            message: "Status codes differ",
          },
        ],
      });

      const { container } = render(<RawDataView diff={diff} />);

      expect(container.firstChild).toMatchSnapshot();
    });

    it("matches snapshot when empty (returns null)", () => {
      const { container } = render(<RawDataView />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("handles null left, right, diff gracefully", () => {
      const { container } = render(
        <RawDataView left={undefined} right={undefined} diff={undefined} />
      );

      expect(container.firstChild).toBeNull();
    });

    it("handles empty signal envelopes", () => {
      const left: SignalEnvelope = {
        schemaVersion: 1,
        comparisonId: "test",
        probeId: "test",
        side: "left",
        requestedUrl: "",
        capturedAt: "",
        result: {
          ok: true,
          response: {
            status: 0,
            finalUrl: "",
            headers: { core: {} },
          },
          durationMs: 0,
        },
      };

      render(<RawDataView left={left} />);

      expect(screen.getByText("Raw Data")).toBeInTheDocument();
      expect(screen.getByText("Left Probe Data")).toBeInTheDocument();
    });

    it("handles complex nested data structures", () => {
      const left = createMockSignalEnvelope({
        result: {
          ok: true,
          response: {
            status: 200,
            finalUrl: "https://example.com",
            headers: {
              core: {
                "cache-control": "max-age=3600",
                "content-type": "application/json",
                "vary": "Accept-Encoding",
              },
            },
          },
          durationMs: 100,
        },
      });

      render(<RawDataView left={left} />);

      expect(screen.getByText("Left Probe Data")).toBeInTheDocument();
    });
  });
});
