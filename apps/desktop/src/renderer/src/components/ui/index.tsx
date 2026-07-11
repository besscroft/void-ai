import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, Loader2, Minus, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";

type PressHandler = () => void;

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color" | "disabled"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isDisabled?: boolean;
  isPending?: boolean;
  isIconOnly?: boolean;
  onPress?: PressHandler;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    children,
    variant = "secondary",
    size = "md",
    isDisabled,
    isPending,
    isIconOnly,
    onPress,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  const disabled =
    isDisabled || isPending || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md text-sm font-medium outline-none transition",
        "focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "active:translate-y-px",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-sm hover:brightness-105",
        variant === "secondary" &&
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        variant === "tertiary" && "text-foreground/70 hover:bg-muted hover:text-foreground",
        variant === "ghost" && "text-foreground/75 hover:bg-muted hover:text-foreground",
        variant === "outline" &&
          "border border-border bg-background text-foreground hover:bg-muted",
        variant === "danger" && "bg-danger text-danger-foreground shadow-sm hover:brightness-105",
        size === "sm" && (isIconOnly ? "size-8" : "h-8 px-3 text-xs"),
        size === "md" && (isIconOnly ? "size-9" : "h-9 px-3.5"),
        size === "lg" && (isIconOnly ? "size-10" : "h-10 px-4"),
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onPress?.();
      }}
      {...props}
    >
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

type ChipColor = "default" | "success" | "danger" | "warning" | "accent";
type ChipVariant = "default" | "soft" | "secondary";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  color?: ChipColor;
  size?: "sm" | "md";
  variant?: ChipVariant;
}

function ChipRoot({
  className,
  children,
  color = "default",
  size = "md",
  variant = "default",
  ...props
}: ChipProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-medium leading-none",
        size === "sm" ? "min-h-5 px-2 py-0.5 text-[11px]" : "min-h-6 px-2.5 py-1 text-xs",
        variant === "secondary" && "border-border bg-secondary text-secondary-foreground",
        variant !== "secondary" &&
          color === "default" &&
          "border-border bg-muted text-muted-foreground",
        variant !== "secondary" &&
          color === "accent" &&
          "border-accent/20 bg-accent/10 text-accent",
        variant !== "secondary" &&
          color === "success" &&
          "border-success/20 bg-success/10 text-success",
        variant !== "secondary" &&
          color === "danger" &&
          "border-danger/20 bg-danger/10 text-danger",
        variant !== "secondary" &&
          color === "warning" &&
          "border-warning/20 bg-warning/10 text-warning",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

function ChipLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("truncate", className)} {...props} />;
}

export const Chip = Object.assign(ChipRoot, { Label: ChipLabel });

function CardRoot({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("p-4 pb-3", className)} {...props} />;
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("border-t border-border p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h3 className={cn("text-sm font-semibold leading-tight", className)} {...props} />;
}

function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("mt-1 text-xs text-muted-foreground", className)} {...props} />;
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Content: CardContent,
  Footer: CardFooter,
  Title: CardTitle,
  Description: CardDescription,
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition",
          "placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("text-sm font-medium", className)} {...props} />;
}

export function Description({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

interface TextFieldProps extends HTMLAttributes<HTMLDivElement> {
  isInvalid?: boolean;
}

export function TextField({ className, isInvalid, ...props }: TextFieldProps): React.JSX.Element {
  return (
    <div
      data-invalid={isInvalid ? "true" : undefined}
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    />
  );
}

// 选项卡组件改用 shadcn/ui（基于 Base UI）实现，源文件见 ./tabs.tsx
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
// 滑块组件改用 shadcn/ui（基于 Base UI）实现，源文件见 ./slider.tsx
export { Slider } from "./slider";

interface ToggleGroupContextValue {
  selectedKeys: Set<string>;
  select: (id: string) => void;
  size: "sm" | "md";
  fullWidth?: boolean;
}

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

interface ToggleButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  selectedKeys?: Iterable<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  selectionMode?: "single" | "multiple";
  disallowEmptySelection?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
}

function ToggleButtonGroupRoot({
  selectedKeys = [],
  onSelectionChange,
  selectionMode = "single",
  disallowEmptySelection,
  size = "md",
  fullWidth,
  className,
  children,
  ...props
}: ToggleButtonGroupProps): React.JSX.Element {
  const selected = new Set(Array.from(selectedKeys).map(String));
  const select = (id: string): void => {
    const next = new Set(selected);
    if (selectionMode === "single") {
      if (selected.has(id) && !disallowEmptySelection) next.clear();
      else {
        next.clear();
        next.add(id);
      }
    } else if (next.has(id)) {
      if (!disallowEmptySelection || next.size > 1) next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange?.(next);
  };
  return (
    <ToggleGroupContext.Provider value={{ selectedKeys: selected, select, size, fullWidth }}>
      <div
        role="group"
        className={cn(
          "inline-flex overflow-hidden rounded-md border border-border bg-muted/40 p-0.5",
          fullWidth && "flex w-full",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

interface ToggleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  id: string;
}

function ToggleButton({ id, className, children, ...props }: ToggleButtonProps): React.JSX.Element {
  const context = useContext(ToggleGroupContext);
  const selected = context?.selectedKeys.has(id) ?? false;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded text-muted-foreground transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        context?.size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
        context?.fullWidth && "flex-1",
        selected && "bg-background text-foreground shadow-sm",
        className,
      )}
      onClick={() => context?.select(id)}
      {...props}
    >
      {children}
    </button>
  );
}

function ToggleSeparator(): React.JSX.Element {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
}

export const ToggleButtonGroup = Object.assign(ToggleButtonGroupRoot, {
  Separator: ToggleSeparator,
});
export { ToggleButton };

interface SwitchContextValue {
  selected: boolean;
  disabled?: boolean;
  size: "sm" | "md";
}

const SwitchContext = createContext<SwitchContextValue | null>(null);

interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "disabled"
> {
  isSelected?: boolean;
  isDisabled?: boolean;
  onChange?: (selected: boolean) => void;
  size?: "sm" | "md";
}

function SwitchRoot({
  isSelected = false,
  isDisabled,
  onChange,
  size = "md",
  className,
  children,
  ...props
}: SwitchProps): React.JSX.Element {
  const hasCompound = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === SwitchContent,
  );
  return (
    <SwitchContext.Provider value={{ selected: isSelected, disabled: isDisabled, size }}>
      <button
        type="button"
        role="switch"
        aria-checked={isSelected}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center gap-2 rounded-md text-sm text-foreground outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onClick={() => onChange?.(!isSelected)}
        {...props}
      >
        {hasCompound ? (
          children
        ) : (
          <SwitchContent>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
            {children}
          </SwitchContent>
        )}
      </button>
    </SwitchContext.Provider>
  );
}

function SwitchContent({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("inline-flex items-center gap-2", className)} {...props} />;
}

function SwitchControl({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  const context = useContext(SwitchContext);
  return (
    <span
      data-state={context?.selected ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-transparent transition",
        context?.size === "sm" ? "h-5 w-9" : "h-6 w-11",
        context?.selected ? "bg-accent" : "bg-muted-foreground/25",
        className,
      )}
      {...props}
    />
  );
}

function SwitchThumb({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  const context = useContext(SwitchContext);
  return (
    <span
      className={cn(
        "block rounded-full bg-background shadow-sm transition-transform",
        context?.size === "sm" ? "size-4" : "size-5",
        context?.selected
          ? context.size === "sm"
            ? "translate-x-4"
            : "translate-x-5"
          : "translate-x-0",
        className,
      )}
      {...props}
    />
  );
}

export const Switch = Object.assign(SwitchRoot, {
  Content: SwitchContent,
  Control: SwitchControl,
  Thumb: SwitchThumb,
});

interface CheckboxContextValue {
  selected: boolean;
  indeterminate?: boolean;
}

const CheckboxContext = createContext<CheckboxContextValue | null>(null);

interface CheckboxProps extends Omit<HTMLAttributes<HTMLLabelElement>, "onChange"> {
  id?: string;
  isSelected?: boolean;
  isIndeterminate?: boolean;
  onChange?: (selected: boolean) => void;
  isDisabled?: boolean;
}

function CheckboxRoot({
  id,
  isSelected = false,
  isIndeterminate,
  onChange,
  isDisabled,
  className,
  children,
  ...props
}: CheckboxProps): React.JSX.Element {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  return (
    <CheckboxContext.Provider value={{ selected: isSelected, indeterminate: isIndeterminate }}>
      <label
        className={cn(
          "inline-flex min-w-0 items-center gap-2 text-sm",
          isDisabled && "cursor-not-allowed opacity-50",
          className,
        )}
        htmlFor={inputId}
        {...props}
      >
        <input
          id={inputId}
          type="checkbox"
          className="sr-only"
          disabled={isDisabled}
          checked={isSelected}
          onChange={(event) => onChange?.(event.currentTarget.checked)}
        />
        {children}
      </label>
    </CheckboxContext.Provider>
  );
}

function CheckboxContent({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("inline-flex min-w-0 items-center gap-2", className)} {...props} />;
}

function CheckboxControl({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  const context = useContext(CheckboxContext);
  return (
    <span
      data-state={context?.selected ? "checked" : "unchecked"}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition",
        context?.selected || context?.indeterminate
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-background",
        className,
      )}
      {...props}
    />
  );
}

function CheckboxIndicator({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element | null {
  const context = useContext(CheckboxContext);
  if (!context?.selected && !context?.indeterminate) return null;
  return (
    <span className={cn("flex items-center justify-center", className)} {...props}>
      {context.indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}
    </span>
  );
}

export const Checkbox = Object.assign(CheckboxRoot, {
  Content: CheckboxContent,
  Control: CheckboxControl,
  Indicator: CheckboxIndicator,
});

interface ModalContextValue {
  close: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

interface ModalProps {
  isOpen: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  children: ReactNode;
}

function ModalRoot({ isOpen, onOpenChange, children }: ModalProps): React.JSX.Element | null {
  if (!isOpen) return null;
  return (
    <ModalContext.Provider value={{ close: () => onOpenChange?.(false) }}>
      {children}
    </ModalContext.Provider>
  );
}

interface ModalBackdropProps extends HTMLAttributes<HTMLDivElement> {
  isDismissable?: boolean;
}

function ModalBackdrop({
  isDismissable,
  className,
  children,
  ...props
}: ModalBackdropProps): React.JSX.Element {
  const context = useContext(ModalContext);
  return (
    <div
      className={cn("fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm", className)}
      onClick={() => {
        if (isDismissable) context?.close();
      }}
      {...props}
    >
      {children}
    </div>
  );
}

interface ModalContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl";
  placement?: "center";
  scroll?: "inside" | "outside";
}

function ModalContainer({
  className,
  children,
  size,
  ...props
}: ModalContainerProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex min-h-full items-center justify-center p-4",
        size === "lg" && "[--modal-width:56rem]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ModalDialog({
  className,
  onClick,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "flex max-h-[92vh] w-[min(var(--modal-width,44rem),calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      {...props}
    />
  );
}

function ModalHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <header className={cn("border-b border-border px-5 py-4", className)} {...props} />;
}

function ModalBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <footer className={cn("border-t border-border px-5 py-4", className)} {...props} />;
}

function ModalHeading({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}

export const Modal = Object.assign(ModalRoot, {
  Backdrop: ModalBackdrop,
  Container: ModalContainer,
  Dialog: ModalDialog,
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
  Heading: ModalHeading,
});

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function PopoverRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <span ref={ref} className="relative inline-flex">
        {children}
      </span>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger({ children }: { children: ReactNode }): React.JSX.Element {
  const context = useContext(PopoverContext);
  const child = Children.only(children);
  if (!isValidElement(child)) return <>{children}</>;
  const element = child as ReactElement<{ onClick?: (event: React.MouseEvent) => void }>;
  return cloneElement(element, {
    onClick: (event: React.MouseEvent) => {
      element.props.onClick?.(event);
      if (!event.defaultPrevented) context?.setOpen(!context.open);
    },
    "aria-expanded": context?.open,
  } as Partial<typeof element.props>);
}

interface PopoverContentProps extends HTMLAttributes<HTMLDivElement> {
  placement?: "top start" | "bottom start" | "top" | "bottom";
  offset?: number;
}

function PopoverContent({
  className,
  placement = "bottom start",
  offset = 8,
  style,
  ...props
}: PopoverContentProps): React.JSX.Element | null {
  const context = useContext(PopoverContext);
  if (!context?.open) return null;
  const vertical = placement.startsWith("top") ? "bottom-full" : "top-full";
  const horizontal = placement.includes("start") ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <div
      className={cn("absolute z-50", vertical, horizontal, className)}
      style={{
        marginTop: vertical === "top-full" ? offset : undefined,
        marginBottom: vertical === "bottom-full" ? offset : undefined,
        ...style,
      }}
      {...props}
    />
  );
}

function PopoverDialog({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn("rounded-md bg-popover text-popover-foreground", className)} {...props} />
  );
}

function PopoverHeading({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h3 className={cn("font-semibold", className)} {...props} />;
}

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Dialog: PopoverDialog,
  Heading: PopoverHeading,
});

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";

interface ColorValue {
  value: string;
  toString: (format?: string) => string;
}

export function parseColor(value: string): ColorValue {
  return {
    value,
    toString: () => value,
  };
}

interface ColorPickerContextValue {
  selected: string | null;
  onChange?: (color: ColorValue) => void;
}

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);
const ColorItemContext = createContext<{ color: string; selected: boolean } | null>(null);

interface ColorSwatchPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: ColorValue;
  onChange?: (color: ColorValue) => void;
  size?: "sm" | "md";
  variant?: "circle" | "square";
}

function ColorSwatchPickerRoot({
  value,
  onChange,
  size: _size,
  variant: _variant,
  className,
  ...props
}: ColorSwatchPickerProps): React.JSX.Element {
  const selected = value?.toString("hex").toLowerCase() ?? null;
  return (
    <ColorPickerContext.Provider value={{ selected, onChange }}>
      <div role="radiogroup" className={cn("flex flex-wrap", className)} {...props} />
    </ColorPickerContext.Provider>
  );
}

interface ColorSwatchItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  color: string;
}

function ColorSwatchItem({
  color,
  className,
  children,
  ...props
}: ColorSwatchItemProps): React.JSX.Element {
  const context = useContext(ColorPickerContext);
  const selected = context?.selected === color.toLowerCase();
  return (
    <ColorItemContext.Provider value={{ color, selected }}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        className={cn(
          "relative flex size-8 items-center justify-center rounded-full border border-border transition",
          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          className,
        )}
        onClick={() => context?.onChange?.(parseColor(color))}
        {...props}
      >
        {children}
      </button>
    </ColorItemContext.Provider>
  );
}

function ColorSwatch({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  const context = useContext(ColorItemContext);
  return (
    <span
      className={cn("block size-6 rounded-full border border-black/10", className)}
      style={{ backgroundColor: context?.color }}
      {...props}
    />
  );
}

function ColorIndicator({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element | null {
  const context = useContext(ColorItemContext);
  if (!context?.selected) return null;
  return (
    <span
      className={cn("absolute inset-0 flex items-center justify-center text-white", className)}
      {...props}
    >
      <Check className="size-3.5 drop-shadow" />
    </span>
  );
}

export const ColorSwatchPicker = Object.assign(ColorSwatchPickerRoot, {
  Item: ColorSwatchItem,
  Swatch: ColorSwatch,
  Indicator: ColorIndicator,
});

interface SearchFieldContextValue {
  value: string;
  onChange?: (value: string) => void;
  label?: string;
}

const SearchFieldContext = createContext<SearchFieldContextValue | null>(null);

interface SearchFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onChange?: (value: string) => void;
  fullWidth?: boolean;
  "aria-label"?: string;
}

function SearchFieldRoot({
  value,
  onChange,
  fullWidth,
  className,
  children,
  "aria-label": ariaLabel,
  ...props
}: SearchFieldProps): React.JSX.Element {
  return (
    <SearchFieldContext.Provider value={{ value, onChange, label: ariaLabel }}>
      <div className={cn("relative", fullWidth && "w-full", className)} {...props}>
        {children}
      </div>
    </SearchFieldContext.Provider>
  );
}

function SearchFieldGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("relative flex items-center", className)} {...props} />;
}

function SearchFieldSearchIcon({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn("pointer-events-none absolute left-3 text-muted-foreground", className)}
      {...props}
    >
      <Search className="size-4" />
    </span>
  );
}

function SearchFieldInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const context = useContext(SearchFieldContext);
  return (
    <Input
      type="search"
      value={context?.value ?? ""}
      aria-label={context?.label}
      onChange={(event) => context?.onChange?.(event.currentTarget.value)}
      className={cn("pl-9 pr-9", className)}
      {...props}
    />
  );
}

function SearchFieldClearButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element | null {
  const context = useContext(SearchFieldContext);
  if (!context?.value) return null;
  return (
    <button
      type="button"
      aria-label="Clear"
      className={cn(
        "absolute right-2 flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={() => context.onChange?.("")}
      {...props}
    >
      <X className="size-3.5" />
    </button>
  );
}

export const SearchField = Object.assign(SearchFieldRoot, {
  Group: SearchFieldGroup,
  SearchIcon: SearchFieldSearchIcon,
  Input: SearchFieldInput,
  ClearButton: SearchFieldClearButton,
});
