import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ControlPlaneProps } from "./ControlPlane";
import { ControlPlane } from "./ControlPlane";

function renderControlPlane(overrides: Partial<ControlPlaneProps> = {}) {
  const props: ControlPlaneProps = {
    leftUrl: "",
    rightUrl: "",
    leftLabel: "",
    rightLabel: "",
    onLeftUrlChange: jest.fn(),
    onRightUrlChange: jest.fn(),
    onLeftLabelChange: jest.fn(),
    onRightLabelChange: jest.fn(),
    onSubmit: jest.fn(),
    isLoading: false,
    ...overrides,
  };
  return { ...render(<ControlPlane {...props} />), props };
}

describe("ControlPlane", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders URL input fields with provided values", () => {
    renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
    });

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    ) as HTMLInputElement;
    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    ) as HTMLInputElement;

    expect(leftUrlInput.value).toBe("https://staging.com");
    expect(rightUrlInput.value).toBe("https://prod.com");
  });

  test("renders label input fields with provided values", () => {
    renderControlPlane({
      leftLabel: "Staging",
      rightLabel: "Production",
    });

    const leftLabelInput = screen.getByPlaceholderText(
      "e.g., Staging"
    ) as HTMLInputElement;
    const rightLabelInput = screen.getByPlaceholderText(
      "e.g., Production"
    ) as HTMLInputElement;

    expect(leftLabelInput.value).toBe("Staging");
    expect(rightLabelInput.value).toBe("Production");
  });

  test("calls onLeftUrlChange when left URL input changes", () => {
    const { props } = renderControlPlane();

    const leftUrlInput = screen.getByPlaceholderText(
      "https://staging.example.com/api/health"
    );
    fireEvent.change(leftUrlInput, {
      target: { value: "https://new-staging.example.com" },
    });

    expect(props.onLeftUrlChange).toHaveBeenCalledWith(
      "https://new-staging.example.com"
    );
  });

  test("calls onRightUrlChange when right URL input changes", () => {
    const { props } = renderControlPlane();

    const rightUrlInput = screen.getByPlaceholderText(
      "https://prod.example.com/api/health"
    );
    fireEvent.change(rightUrlInput, {
      target: { value: "https://new-prod.example.com" },
    });

    expect(props.onRightUrlChange).toHaveBeenCalledWith(
      "https://new-prod.example.com"
    );
  });

  test("calls onLeftLabelChange when left label input changes", () => {
    const { props } = renderControlPlane();

    const leftLabelInput = screen.getByPlaceholderText("e.g., Staging");
    fireEvent.change(leftLabelInput, { target: { value: "Custom Staging" } });

    expect(props.onLeftLabelChange).toHaveBeenCalledWith("Custom Staging");
  });

  test("calls onRightLabelChange when right label input changes", () => {
    const { props } = renderControlPlane();

    const rightLabelInput = screen.getByPlaceholderText("e.g., Production");
    fireEvent.change(rightLabelInput, {
      target: { value: "Custom Production" },
    });

    expect(props.onRightLabelChange).toHaveBeenCalledWith("Custom Production");
  });

  test("swap button calls all onChange handlers with swapped values", () => {
    const { props } = renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      leftLabel: "Staging",
      rightLabel: "Production",
    });

    const swapButton = screen.getByRole("button", { name: /swap/i });
    fireEvent.click(swapButton);

    expect(props.onLeftUrlChange).toHaveBeenCalledWith("https://prod.com");
    expect(props.onRightUrlChange).toHaveBeenCalledWith("https://staging.com");
    expect(props.onLeftLabelChange).toHaveBeenCalledWith("Production");
    expect(props.onRightLabelChange).toHaveBeenCalledWith("Staging");
  });

  test("submit button is disabled when URLs are empty", () => {
    renderControlPlane();

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is disabled when only left URL is empty", () => {
    renderControlPlane({ rightUrl: "https://prod.com" });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is disabled when only right URL is empty", () => {
    renderControlPlane({ leftUrl: "https://staging.com" });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button is enabled when both URLs are present", () => {
    renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    expect(submitButton).not.toBeDisabled();
  });

  test("submit button is disabled during loading", () => {
    renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      isLoading: true,
    });

    const submitButton = screen.getByRole("button", { name: /comparing/i });
    expect(submitButton).toBeDisabled();
  });

  test("submit button text changes during loading", () => {
    const { rerender } = render(
      <ControlPlane
        leftUrl="https://a.com"
        rightUrl="https://b.com"
        onLeftUrlChange={jest.fn()}
        onRightUrlChange={jest.fn()}
        onLeftLabelChange={jest.fn()}
        onRightLabelChange={jest.fn()}
        onSubmit={jest.fn()}
        isLoading={false}
      />
    );

    expect(
      screen.getByRole("button", { name: /^Compare$/ })
    ).toBeInTheDocument();

    rerender(
      <ControlPlane
        leftUrl="https://a.com"
        rightUrl="https://b.com"
        onLeftUrlChange={jest.fn()}
        onRightUrlChange={jest.fn()}
        onLeftLabelChange={jest.fn()}
        onRightLabelChange={jest.fn()}
        onSubmit={jest.fn()}
        isLoading={true}
      />
    );

    expect(
      screen.getByRole("button", { name: /comparing/i })
    ).toBeInTheDocument();
  });

  test("form submission calls onSubmit with trimmed URLs and labels", () => {
    const { props } = renderControlPlane({
      leftUrl: "  https://staging.com  ",
      rightUrl: "  https://prod.com  ",
      leftLabel: "  Staging  ",
      rightLabel: "  Production  ",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(props.onSubmit).toHaveBeenCalledWith({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      leftLabel: "Staging",
      rightLabel: "Production",
    });
  });

  test("form submission calls onSubmit with undefined labels when empty", () => {
    const { props } = renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(props.onSubmit).toHaveBeenCalledWith({
      leftUrl: "https://staging.com",
      rightUrl: "https://prod.com",
      leftLabel: undefined,
      rightLabel: undefined,
    });
  });

  test("swap button is disabled during loading", () => {
    renderControlPlane({ isLoading: true });

    const swapButton = screen.getByRole("button", { name: /swap/i });
    expect(swapButton).toBeDisabled();
  });

  test("all inputs are disabled during loading", () => {
    renderControlPlane({ isLoading: true });

    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  test("shows private IP warning for localhost (left URL)", () => {
    const { props } = renderControlPlane({
      leftUrl: "http://localhost:3000",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(/left URL appears to be private/i)
    ).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("shows private IP warning for 127.0.0.1 (right URL)", () => {
    const { props } = renderControlPlane({
      leftUrl: "https://staging.com",
      rightUrl: "http://127.0.0.1:8080",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(/right URL appears to be private/i)
    ).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("shows private IP warning for private IP ranges", () => {
    const { props } = renderControlPlane({
      leftUrl: "http://192.168.1.100",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(/left URL appears to be private/i)
    ).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("warning is dismissible via X button", () => {
    renderControlPlane({
      leftUrl: "http://localhost:3000",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(/left URL appears to be private/i)
    ).toBeInTheDocument();

    const dismissButton = screen.getByTitle("Dismiss warning");
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText(/left URL appears to be private/i)
    ).not.toBeInTheDocument();
  });

  test("warning re-appears on subsequent submit with private IP", () => {
    renderControlPlane({
      leftUrl: "http://localhost:3000",
      rightUrl: "https://prod.com",
    });

    const submitButton = screen.getByRole("button", { name: /compare/i });
    fireEvent.click(submitButton);

    expect(
      screen.getByText(/left URL appears to be private/i)
    ).toBeInTheDocument();

    const dismissButton = screen.getByTitle("Dismiss warning");
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText(/left URL appears to be private/i)
    ).not.toBeInTheDocument();

    fireEvent.click(submitButton);
    expect(
      screen.getByText(/left URL appears to be private/i)
    ).toBeInTheDocument();
  });
});
