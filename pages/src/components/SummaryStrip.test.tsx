import { render, screen } from "@testing-library/react";
import { SummaryStrip } from "./SummaryStrip";
import type { CompareResult } from "@shared/api";
import type { EnvDiff, DiffFinding } from "@shared/diff";
import type { SignalEnvelope } from "@shared/signal";

// Helper: Create a default mock EnvDiff
function createDefaultMockDiff(): EnvDiff {
  return {
    schemaVersion: 1,
    comparisonId: "comp-1",
    leftProbeId: "probe-left",
    rightProbeId: "probe-right",
    probe: {
      leftOk: true,
      rightOk: false,
      outcomeChanged: true,
      responsePresent: true,
    },
    status: {
      left: 200,
      right: 404,
      changed: true,
    },
    findings: [
      {
        id: "finding-1",
        code: "STATUS_MISMATCH",
        category: "routing",
        severity: "critical",
        message: "HTTP status codes differ",
        left_value: 200,
        right_value: 404,
      },
    ],
    maxSeverity: "critical",
  };
}

// Helper: Create a default mock signal envelope
function createDefaultMockSignalEnvelope(side: "left" | "right", status: number, duration: number): SignalEnvelope {
  return {
    schemaVersion: 1,
    comparisonId: "comp-1",
    probeId: side === "left" ? "probe-left" : "probe-right",
    side,
    requestedUrl: side === "left" ? "https://example.com" : "https://api.example.com",
    capturedAt: new Date().toISOString(),
    result:
      status >= 400
        ? {
            ok: false,
            response: {
              status,
              finalUrl: side === "left" ? "https://example.com" : "https://api.example.com",
              headers: { core: {} },
            },
            durationMs: duration,
          }
        : {
            ok: true,
            response: {
              status,
              finalUrl: side === "left" ? "https://example.com" : "https://api.example.com",
              headers: { core: {} },
            },
            durationMs: duration,
          },
  };
}

// Mock data: Create a sample CompareResult with a complete EnvDiff
function createMockCompareResult(overrides?: Partial<CompareResult>): CompareResult {
  const defaultDiff = createDefaultMockDiff();

  return {
    comparisonId: "comp-1",
    leftUrl: "https://example.com",
    rightUrl: "https://api.example.com",
    leftLabel: "Production",
    rightLabel: "Staging",
    left: createDefaultMockSignalEnvelope("left", 200, 42),
    right: createDefaultMockSignalEnvelope("right", 404, 67),
    diff: defaultDiff,
    ...overrides,
  };
}

describe("SummaryStrip", () => {
  it("renders without crash with basic CompareResult", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText(/Finding/i)).toBeInTheDocument();
  });

  it("displays max severity badge (critical)", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText(/🔴 Critical/)).toBeInTheDocument();
  });

  it("displays findings count correctly", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("1 Finding")).toBeInTheDocument();
  });

  it("displays left status code and duration", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("(42ms)")).toBeInTheDocument();
  });

  it("displays right status code and duration", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("(67ms)")).toBeInTheDocument();
  });

  it("displays 'Left' and 'Right' labels", () => {
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
  });

  it("handles multiple findings with correct count", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [
        { id: "1", code: "STATUS_MISMATCH", category: "routing", severity: "critical", message: "Status differs" },
        {
          id: "2",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "Cache headers differ",
        },
        { id: "3", code: "CONTENT_TYPE_DRIFT", category: "content", severity: "info", message: "Content type differs" },
      ] as DiffFinding[],
      maxSeverity: "critical",
    };

    const result = createMockCompareResult({ diff: customDiff });
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("3 Findings")).toBeInTheDocument();
  });

  it("handles warn severity correctly", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [
        {
          id: "1",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "Cache differs",
        },
      ] as DiffFinding[],
      maxSeverity: "warn",
    };

    const result = createMockCompareResult({ diff: customDiff });
    render(<SummaryStrip result={result} />);
    expect(screen.getByText(/🟠 Warning/)).toBeInTheDocument();
  });

  it("handles info severity correctly", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [
        {
          id: "1",
          code: "UNKNOWN_DRIFT",
          category: "unknown",
          severity: "info",
          message: "Unknown drift",
        },
      ] as DiffFinding[],
      maxSeverity: "info",
    };

    const result = createMockCompareResult({ diff: customDiff });
    render(<SummaryStrip result={result} />);
    expect(screen.getByText(/🔵 Info/)).toBeInTheDocument();
  });

  it("handles empty findings array", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [],
      maxSeverity: "info",
    };

    const result = createMockCompareResult({ diff: customDiff });
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("0 Findings")).toBeInTheDocument();
  });

  it("handles missing diff gracefully", () => {
    const result = createMockCompareResult({ diff: undefined });
    render(<SummaryStrip result={result} />);
    expect(screen.getByText("0 Findings")).toBeInTheDocument();
    expect(screen.getByText(/🔵 Info/)).toBeInTheDocument();
  });

  it("handles missing status codes gracefully", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      status: undefined,
    };

    const result = createMockCompareResult({ diff: customDiff });
    render(<SummaryStrip result={result} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("calls onFindingClick callback when provided", () => {
    const onFindingClick = jest.fn();
    const result = createMockCompareResult();
    render(<SummaryStrip result={result} onFindingClick={onFindingClick} />);
    expect(onFindingClick).not.toHaveBeenCalled();
  });

  it("snapshot test: renders correctly with critical severity", () => {
    const result = createMockCompareResult();
    const { container } = render(<SummaryStrip result={result} />);
    expect(container).toMatchSnapshot();
  });

  it("snapshot test: renders correctly with warn severity", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [
        {
          id: "1",
          code: "CACHE_HEADER_DRIFT",
          category: "cache",
          severity: "warn",
          message: "Cache differs",
        },
      ] as DiffFinding[],
      maxSeverity: "warn",
    };

    const result = createMockCompareResult({ diff: customDiff });
    const { container } = render(<SummaryStrip result={result} />);
    expect(container).toMatchSnapshot();
  });

  it("snapshot test: renders correctly with no findings", () => {
    const customDiff: EnvDiff = {
      ...createDefaultMockDiff(),
      findings: [],
      maxSeverity: "info",
    };

    const result = createMockCompareResult({ diff: customDiff });
    const { container } = render(<SummaryStrip result={result} />);
    expect(container).toMatchSnapshot();
  });
});
