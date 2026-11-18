"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { onboardingSchema } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { completeOnboarding } from "./actions";

export type WizardValues = {
  companyName: string;
  niche: string;
  productsServices: string;
  averageTicket: string;
  targetAudience: string;
  differentiators: string;
  toneOfVoice: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  styleNotes: string;
};

type Field = keyof WizardValues;

const DEFAULTS: WizardValues = {
  companyName: "",
  niche: "",
  productsServices: "",
  averageTicket: "",
  targetAudience: "",
  differentiators: "",
  toneOfVoice: "",
  primaryColor: "#00D4FF",
  secondaryColor: "#2563EB",
  logoUrl: "",
  styleNotes: "",
};

const STEPS: { title: string; description: string; fields: Field[] }[] = [
  {
    title: "Sua empresa",
    description: "O básico para o Hermes entender o que você vende.",
    fields: ["companyName", "niche", "productsServices", "averageTicket"],
  },
  {
    title: "Seu público",
    description: "Para quem você vende e por que escolhem você.",
    fields: ["targetAudience", "differentiators"],
  },
  {
    title: "Tom de voz",
    description: "Como a sua marca conversa com os clientes.",
    fields: ["toneOfVoice"],
  },
  {
    title: "Identidade visual",
    description: "Cores e referências usadas nos carrosséis, criativos e páginas.",
    fields: ["primaryColor", "secondaryColor", "logoUrl", "styleNotes"],
  },
];

const TONE_PRESETS = [
  "Profissional e confiável",
  "Próximo e acolhedor",
  "Inspirador e motivacional",
  "Descontraído e bem-humorado",
  "Técnico e especialista",
  "Sofisticado e exclusivo",
];

export function OnboardingWizard({ initial }: { initial: Partial<WizardValues> }) {
  const [values, setValues] = useState<WizardValues>({ ...DEFAULTS, ...initial });
  const [step, setStep] = useState(0);
  const [clientErrors, setClientErrors] = useState<Partial<Record<Field, string>>>({});
  const [state, action] = useActionState(completeOnboarding, undefined);
  const [pending, startTransition] = useTransition();

  // Erro vindo do servidor: volta para a primeira etapa com campo inválido.
  useEffect(() => {
    const fieldErrors = state?.fieldErrors;
    if (!fieldErrors) return;
    const index = STEPS.findIndex((s) => s.fields.some((field) => fieldErrors[field]));
    if (index >= 0) setStep(index);
  }, [state]);

  const errors = { ...state?.fieldErrors, ...clientErrors } as Partial<Record<Field, string>>;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const set = (field: Field) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setClientErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  function validateStep(): boolean {
    const shape = Object.fromEntries(current.fields.map((field) => [field, true])) as Partial<Record<Field, true>>;
    const result = onboardingSchema.pick(shape).safeParse(normalize(values));
    if (result.success) return true;
    const next: Partial<Record<Field, string>> = {};
    for (const issue of result.error.issues) next[issue.path[0] as Field] ??= issue.message;
    setClientErrors(next);
    return false;
  }

  function goNext() {
    if (!validateStep()) return;
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    const formData = new FormData();
    for (const [key, value] of Object.entries(normalize(values))) {
      if (value !== undefined) formData.set(key, String(value));
    }
    startTransition(() => action(formData));
  }

  return (
    <div className="glass mt-8 rounded-2xl p-6 sm:p-8">
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-primary">
            Etapa {step + 1} de {STEPS.length}
          </span>
          <span className="text-muted-foreground">{current.title}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Progresso do onboarding" />
      </div>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          goNext();
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            <div>
              <h2 className="text-xl font-semibold">{current.title}</h2>
              <p className="text-sm text-muted-foreground">{current.description}</p>
            </div>

            {step === 0 && (
              <>
                <TextField id="companyName" label="Nome da empresa" value={values.companyName} onChange={set("companyName")} error={errors.companyName} placeholder="Ex.: Clínica Sorriso Pleno" />
                <TextField id="niche" label="Nicho de atuação" value={values.niche} onChange={set("niche")} error={errors.niche} placeholder="Ex.: Odontologia estética" />
                <AreaField id="productsServices" label="Produtos e serviços" value={values.productsServices} onChange={set("productsServices")} error={errors.productsServices} placeholder="Liste o que você vende e o que cada oferta resolve para o cliente." />
                <TextField id="averageTicket" label="Ticket médio (R$)" hint="Opcional. Ajuda o Hermes a qualificar leads e definir orçamentos de anúncio." type="number" inputMode="decimal" min={0} value={values.averageTicket} onChange={set("averageTicket")} error={errors.averageTicket} placeholder="Ex.: 1500" />
              </>
            )}

            {step === 1 && (
              <>
                <AreaField id="targetAudience" label="Público-alvo" value={values.targetAudience} onChange={set("targetAudience")} error={errors.targetAudience} placeholder="Quem é seu cliente ideal? Idade, região, profissão, dores e desejos." />
                <AreaField id="differentiators" label="Diferenciais" value={values.differentiators} onChange={set("differentiators")} error={errors.differentiators} placeholder="O que faz os clientes escolherem você e não a concorrência?" />
              </>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <Label>Escolha um estilo ou descreva o seu</Label>
                <div className="flex flex-wrap gap-2">
                  {TONE_PRESETS.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => set("toneOfVoice")(tone)}
                      aria-pressed={values.toneOfVoice === tone}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        values.toneOfVoice === tone
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
                <AreaField id="toneOfVoice" label="Tom de voz" value={values.toneOfVoice} onChange={set("toneOfVoice")} error={errors.toneOfVoice} placeholder="Ex.: Falamos de forma clara e acolhedora, sem jargões técnicos." />
              </div>
            )}

            {step === 3 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField id="primaryColor" label="Cor primária" value={values.primaryColor} onChange={set("primaryColor")} error={errors.primaryColor} />
                  <ColorField id="secondaryColor" label="Cor secundária" value={values.secondaryColor} onChange={set("secondaryColor")} error={errors.secondaryColor} />
                </div>
                <TextField id="logoUrl" label="Link do logo" hint="Opcional. Você também poderá enviar o arquivo depois." type="url" value={values.logoUrl} onChange={set("logoUrl")} error={errors.logoUrl} placeholder="https://..." />
                <AreaField id="styleNotes" label="Referências de estilo" hint="Opcional." value={values.styleNotes} onChange={set("styleNotes")} error={errors.styleNotes} placeholder="Ex.: visual minimalista, fotos reais da equipe, fonte moderna." />
                <div
                  className="rounded-xl p-5 text-white"
                  style={{ background: `linear-gradient(135deg, ${values.primaryColor}, ${values.secondaryColor})` }}
                >
                  <p className="text-xs tracking-wide uppercase opacity-80">Prévia de carrossel</p>
                  <p className="mt-2 text-lg font-semibold">{values.companyName || "Sua empresa"}</p>
                  <p className="text-sm opacity-90">{values.niche || "Seu nicho"}</p>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {state?.error && (
          <p role="alert" className="mt-5 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || pending}>
            <ArrowLeft className="size-4" /> Voltar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : isLast ? <Check className="size-4" /> : null}
            {isLast ? "Concluir e acessar o painel" : "Continuar"}
            {!isLast && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Campos opcionais vazios viram undefined para o schema.
function normalize(values: WizardValues) {
  return {
    ...values,
    averageTicket: values.averageTicket.trim() === "" ? undefined : values.averageTicket,
    styleNotes: values.styleNotes.trim() === "" ? undefined : values.styleNotes,
  };
}

type FieldProps = {
  id: Field;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
};

function FieldShell({ id, label, error, hint, children }: Omit<FieldProps, "value" | "onChange"> & { children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function TextField({ value, onChange, ...props }: FieldProps & Omit<React.ComponentProps<"input">, "id" | "value" | "onChange">) {
  const { id, label, error, hint, placeholder, ...inputProps } = props;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...inputProps}
      />
    </FieldShell>
  );
}

function AreaField({ id, label, value, onChange, error, hint, placeholder }: FieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <Textarea
        id={id}
        rows={4}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </FieldShell>
  );
}

function ColorField({ id, label, value, onChange, error }: FieldProps) {
  return (
    <FieldShell id={id} label={label} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor)`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent"
        />
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={!!error} className="font-mono" />
      </div>
    </FieldShell>
  );
}
