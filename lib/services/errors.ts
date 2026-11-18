// Erro de regra de negócio cuja mensagem é segura e útil para o usuário final (pt-BR).
// Qualquer outro erro é tratado como interno: registrado em log e trocado por mensagem genérica.
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
