import { toast } from "sonner";
import { getErrorMessage } from "./errors";

export { getErrorMessage } from "./errors";

export const notify = {
  success(message: string): void {
    toast.success(message);
  },
  error(message: string, error?: unknown): void {
    const detail = error === undefined ? "" : `: ${getErrorMessage(error)}`;
    toast.error(`${message}${detail}`);
  },
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ): Promise<T> {
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: (error) => `${messages.error}: ${getErrorMessage(error)}`,
    });
    return promise;
  },
};
