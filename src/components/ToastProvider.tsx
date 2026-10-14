import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { ToastContext, type ToastMessage } from "./toast-context";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);
  const notify = useCallback(
    (message: string) => {
      const id = ++nextId.current;
      setMessages((current) => [...current, { id, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 6000),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.map((item) => (
          <div className="toast" key={item.id}>
            <p>{item.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(item.id)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
