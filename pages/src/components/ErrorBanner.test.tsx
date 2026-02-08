import { render, screen, fireEvent } from "@testing-library/react";
import type { CompareError } from "@shared/api";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("renders nothing when error is null", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when error is undefined", () => {
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("displays title and guidance for invalid_request", () => {
    const error: CompareError = {
      code: "invalid_request",
      message: "Both URLs are required.",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.getByText("Invalid Input")).toBeTruthy();
    expect(
      screen.getByText(/Check that both URLs are formatted correctly/)
    ).toBeTruthy();
  });

  it("displays title and guidance for ssrf_blocked", () => {
    const error: CompareError = {
      code: "ssrf_blocked",
      message: "Private IP detected.",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.getByText("Private/Local Network Blocked")).toBeTruthy();
    expect(
      screen.getByText(/Both URLs must be publicly accessible/)
    ).toBeTruthy();
  });

  it("displays title and guidance for timeout", () => {
    const error: CompareError = {
      code: "timeout",
      message: "Timed out after 10s.",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.getByText("Request Timeout")).toBeTruthy();
  });

  it("displays error.message as detail when present", () => {
    const error: CompareError = {
      code: "dns_error",
      message: "NXDOMAIN for example.invalid",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.getByText("NXDOMAIN for example.invalid")).toBeTruthy();
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = jest.fn();
    const error: CompareError = {
      code: "fetch_error",
      message: "Connection refused.",
    };
    render(<ErrorBanner error={error} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides dismiss button when onDismiss is not provided", () => {
    const error: CompareError = {
      code: "internal_error",
      message: "Unexpected failure.",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.queryByLabelText("Dismiss error")).toBeNull();
  });

  it("has role=alert for accessibility", () => {
    const error: CompareError = {
      code: "tls_error",
      message: "Certificate expired.",
    };
    render(<ErrorBanner error={error} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("snapshot: internal_error", () => {
    const error: CompareError = {
      code: "internal_error",
      message: "Something went wrong.",
    };
    const { container } = render(
      <ErrorBanner error={error} onDismiss={() => {}} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
