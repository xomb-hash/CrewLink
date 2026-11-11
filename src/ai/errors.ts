export class AiValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AiValidationError';
  }
}

export class AiForbiddenError extends Error {
  readonly status = 403;

  constructor(message = 'Only the project owner can use the AI workspace for this project.') {
    super(message);
    this.name = 'AiForbiddenError';
  }
}

export class AiNotFoundError extends Error {
  readonly status = 404;

  constructor(message = 'Not found.') {
    super(message);
    this.name = 'AiNotFoundError';
  }
}

export class AiConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'AiConflictError';
  }
}

export class AiUnavailableError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
