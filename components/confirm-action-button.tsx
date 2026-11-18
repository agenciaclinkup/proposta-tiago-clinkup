"use client";

import { useActionState, type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ActionState = { error?: string; success?: string } | undefined;

// Server Action destrutiva com confirmação do navegador antes de enviar.
export function ConfirmActionButton({
  action,
  fields,
  confirmMessage,
  children,
  ...buttonProps
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  confirmMessage: string;
  children: ReactNode;
} & Pick<ComponentProps<typeof Button>, "variant" | "size" | "className" | "aria-label" | "title">) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" disabled={pending} aria-busy={pending} {...buttonProps}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : children}
      </Button>
      {state?.error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="mt-1 text-xs text-primary">
          {state.success}
        </p>
      )}
    </form>
  );
}
