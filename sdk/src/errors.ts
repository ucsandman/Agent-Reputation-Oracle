// ─── Error Hierarchy ───

export class OracleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleError';
  }
}

export class OracleHttpError extends OracleError {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'OracleHttpError';
    this.status = status;
    this.body = body;
  }
}

export class AgentNotFoundError extends OracleHttpError {
  constructor(body: unknown) {
    super('Agent not found', 404, body);
    this.name = 'AgentNotFoundError';
  }
}

export class PaymentRequiredError extends OracleHttpError {
  constructor(body: unknown) {
    super('Payment required (x402)', 402, body);
    this.name = 'PaymentRequiredError';
  }
}

export class ValidationError extends OracleHttpError {
  constructor(body: unknown) {
    super('Validation error', 400, body);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends OracleHttpError {
  constructor(body: unknown) {
    super('Rate limit exceeded', 429, body);
    this.name = 'RateLimitError';
  }
}
