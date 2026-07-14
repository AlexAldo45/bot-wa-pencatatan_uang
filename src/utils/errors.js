class BaseError extends Error {
    constructor(message, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends BaseError {
    constructor(message) {
        super(message, 'VALIDATION_ERROR');
    }
}

class AuthorizationError extends BaseError {
    constructor(message) {
        super(message, 'AUTHORIZATION_ERROR');
    }
}

class NotFoundError extends BaseError {
    constructor(message) {
        super(message, 'NOT_FOUND_ERROR');
    }
}

class ConflictError extends BaseError {
    constructor(message) {
        super(message, 'CONFLICT_ERROR');
    }
}

class AIProviderError extends BaseError {
    constructor(message) {
        super(message, 'AI_PROVIDER_ERROR');
    }
}

class DatabaseError extends BaseError {
    constructor(message) {
        super(message, 'DATABASE_ERROR');
    }
}

/**
 * Helper to check if an error is a safe custom error
 */
function isCustomError(err) {
    return err instanceof BaseError;
}

module.exports = {
    BaseError,
    ValidationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    AIProviderError,
    DatabaseError,
    isCustomError,
};
