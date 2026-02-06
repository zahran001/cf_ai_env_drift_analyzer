import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProgressIndicator } from "./ProgressIndicator";

describe("ProgressIndicator", () => {
  test("renders nothing when status is idle", () => {
    const { container } = render(
      <ProgressIndicator status="idle" progress="Initializing…" elapsedMs={100} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when status is completed", () => {
    const { container } = render(
      <ProgressIndicator
        status="completed"
        progress="Complete"
        elapsedMs={5000}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when status is failed", () => {
    const { container } = render(
      <ProgressIndicator status="failed" progress="Error" elapsedMs={1000} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders spinner when status is running", () => {
    const { container } = render(
      <ProgressIndicator status="running" progress="Processing…" elapsedMs={500} />
    );
    expect(container.querySelector(".spinner")).toBeInTheDocument();
  });

  test("renders progress message when provided", () => {
    render(
      <ProgressIndicator
        status="running"
        progress="Probing environments…"
        elapsedMs={2500}
      />
    );
    expect(screen.getByText("Probing environments…")).toBeInTheDocument();
  });

  test("formats elapsed time correctly", () => {
    render(
      <ProgressIndicator status="running" progress="Processing…" elapsedMs={2500} />
    );
    expect(screen.getByText("2.5s")).toBeInTheDocument();
  });

  test("formats elapsed time with one decimal place", () => {
    render(
      <ProgressIndicator status="running" progress="Processing…" elapsedMs={5234} />
    );
    expect(screen.getByText("5.2s")).toBeInTheDocument();
  });

  test("handles zero elapsed time", () => {
    render(
      <ProgressIndicator status="running" progress="Starting…" elapsedMs={0} />
    );
    expect(screen.getByText("0.0s")).toBeInTheDocument();
  });

  test("hides progress message when not provided", () => {
    const { container } = render(
      <ProgressIndicator status="running" elapsedMs={1000} />
    );
    expect(container.querySelector(".message")).not.toBeInTheDocument();
  });

  test("hides elapsed time when not provided", () => {
    const { container } = render(
      <ProgressIndicator status="running" progress="Processing…" />
    );
    expect(container.querySelector(".elapsed")).not.toBeInTheDocument();
  });

  test("renders with both message and elapsed time", () => {
    render(
      <ProgressIndicator
        status="running"
        progress="Analyzing drift…"
        elapsedMs={6500}
      />
    );
    expect(screen.getByText("Analyzing drift…")).toBeInTheDocument();
    expect(screen.getByText("6.5s")).toBeInTheDocument();
  });

  test("spinner is always present during running status", () => {
    const { container } = render(
      <ProgressIndicator status="running" elapsedMs={100} />
    );
    expect(container.querySelector(".spinner")).toBeInTheDocument();
  });
});
