import { toast } from "sonner";
import { getErrorMessage } from "./errors";

export { getErrorMessage } from "./errors";

export const notify = {
  success(message: string): void {
    toast.success(message);
  },
  error(message: string, error?: unknown, locale?: string): void {
    const detail = error === undefined ? "" : `: ${getErrorMessage(error, locale)}`;
    toast.error(`${message}${detail}`);
  },
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
    locale?: string,
  ): Promise<T> {
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: (error) => `${messages.error}: ${getErrorMessage(error, locale)}`,
    });
    return promise;
  },
};
