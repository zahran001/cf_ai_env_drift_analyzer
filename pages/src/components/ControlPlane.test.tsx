import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ControlPlane } from "./ControlPlane";

describe("ControlPlane", () => {
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders URL input fields and starts empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    expect(leftUrlInput.value).toBe("");
    expect(rightUrlInput.value).toBe("");
  });

  test("renders label input fields and starts empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftLabelInput = screen.getByPlaceholderText("e.g., Staging") as HTMLInputElement;
    const rightLabelInput = screen.getByPlaceholderText("e.g., Production") as HTMLInputElement;

    expect(leftLabelInput.value).toBe("");
    expect(rightLabelInput.value).toBe("");
  });

  test("updates left URL on input change", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    fireEvent.change(leftUrlInput, {
      target: { value: "https://new-staging.example.com" },
    });

    expect(leftUrlInput.value).toBe("https://new-staging.example.com");
  });

  test("updates right URL on input change", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;
    fireEvent.change(rightUrlInput, {
      target: { value: "https://new-prod.example.com" },
    });

    expect(rightUrlInput.value).toBe("https://new-prod.example.com");
  });

  test("updates left label on input change", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftLabelInput = screen.getByPlaceholderText("e.g., Staging") as HTMLInputElement;
    fireEvent.change(leftLabelInput, { target: { value: "Custom Staging" } });

    expect(leftLabelInput.value).toBe("Custom Staging");
  });

  test("updates right label on input change", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const rightLabelInput = screen.getByPlaceholderText("e.g., Production") as HTMLInputElement;
    fireEvent.change(rightLabelInput, { target: { value: "Custom Production" } });

    expect(rightLabelInput.value).toBe("Custom Production");
  });

  test("swap button exchanges URLs and labels", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;
    const leftLabelInput = screen.getByPlaceholderText("e.g., Staging") as HTMLInputElement;
    const rightLabelInput = screen.getByPlaceholderText("e.g., Production") as HTMLInputElement;

    // Set initial values
    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });
    fireEvent.change(leftLabelInput, { target: { value: "Staging" } });
    fireEvent.change(rightLabelInput, { target: { value: "Production" } });

    // Click swap button
    const swapButton = screen.getByRole("button", { name: /swap/i });
    fireEvent.click(swapButton);

    // Verify swap occurred
    expect(leftUrlInput.value).toBe("https://prod.com");
    expect(rightUrlInput.value).toBe("https://staging.com");
    expect(leftLabelInput.value).toBe("Production");
    expect(rightLabelInput.value).toBe("Staging");
  });

  test("submit button is disabled when URLs are empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is disabled when only left URL is empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is disabled when only right URL is empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is enabled when both URLs are present", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).not.toBeDisabled();
  });

  test("submit button is disabled during loading", () => {
    const { rerender } = render(
      <ControlPlane onSubmit={mockOnSubmit} isLoading={false} />
    );

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    rerender(<ControlPlane onSubmit={mockOnSubmit} isLoading={true} />);

    const submitButton = screen.getByRole("button", { name: /comparing/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button text changes during loading", () => {
    const { rerender } = render(
      <ControlPlane onSubmit={mockOnSubmit} isLoading={false} />
    );

    expect(screen.getByRole("button", { name: /^Compare$/ })).toBeInTheDocument();

    rerender(<ControlPlane onSubmit={mockOnSubmit} isLoading={true} />);

    expect(screen.getByRole("button", { name: /comparing/i })).toBeInTheDocument();
  });

  test("form submission calls onSubmit with trimmed URLs and labels", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;
    const leftLabelInput = screen.getByPlaceholderText("e.g., Staging") as HTMLInputElement;
    const rightLabelInput = screen.getByPlaceholderText("e.g., Production") as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "  https://staging.com  " } });
    fireEvent.change(rightUrlInput, { target: { value: "  https://prod.com  " } });
    fireEvent.change(leftLabelInput, { target: { value: "  Staging  " } });
    fireEvent.change(rightLabelInput, { target: { value: "  Production  " } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(mockOnSubmit).toHaveBeenCalledWith({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      leftLabel: "Staging",
      rightLabel: "Production",
    });
  });

  test("form submission calls onSubmit with undefined labels when empty", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(mockOnSubmit).toHaveBeenCalledWith({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      leftLabel: undefined,
      rightLabel: undefined,
    });
  });

  test("swap button is disabled during loading", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={true} />);

    const swapButton = screen.getByRole("button", { name: /swap/i });
    expect(swapButton).toBeDisabled();
  });

  test("all inputs are disabled during loading", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={true} />);

    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  test("shows private IP warning for localhost (left URL)", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "http://localhost:3000" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    // Warning should be shown, onSubmit should NOT be called
    expect(screen.getByText(/left URL appears to be private/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  test("shows private IP warning for 127.0.0.1 (right URL)", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "https://staging.com" } });
    fireEvent.change(rightUrlInput, { target: { value: "http://127.0.0.1:8080" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    // Warning should be shown, onSubmit should NOT be called
    expect(screen.getByText(/right URL appears to be private/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  test("shows private IP warning for private IP ranges", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "http://192.168.1.100" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    // Warning should be shown
    expect(screen.getByText(/left URL appears to be private/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  test("warning is dismissible via X button", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "http://localhost:3000" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(screen.getByText(/left URL appears to be private/i)).toBeInTheDocument();

    // Dismiss the warning
    const dismissButton = screen.getByTitle("Dismiss warning");
    fireEvent.click(dismissButton);

    expect(screen.queryByText(/left URL appears to be private/i)).not.toBeInTheDocument();
  });

  test("warning allows re-submission after dismissal (warning rechecks on each submit)", () => {
    render(<ControlPlane onSubmit={mockOnSubmit} isLoading={false} />);

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    fireEvent.change(leftUrlInput, { target: { value: "http://localhost:3000" } });
    fireEvent.change(rightUrlInput, { target: { value: "https://prod.com" } });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    // Warning should be shown on first submit
    expect(screen.getByText(/left URL appears to be private/i)).toBeInTheDocument();

    // Dismiss warning
    const dismissButton = screen.getByTitle("Dismiss warning");
    fireEvent.click(dismissButton);

    expect(screen.queryByText(/left URL appears to be private/i)).not.toBeInTheDocument();

    // Submit again - warning will re-appear (private IP check happens on every submit)
    fireEvent.click(submitButton);
    expect(screen.getByText(/left URL appears to be private/i)).toBeInTheDocument();
  });
});
