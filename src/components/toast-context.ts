import { createContext, useContext } from "react";

export type ToastMessage = { id: number; message: string };
export const ToastContext = createContext<((message: string) => void) | null>(
  null,
);
export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast must be used inside ToastProvider");
  return notify;
}
