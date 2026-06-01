"use strict";
/**
 * Runtime schema validation for Horizon and RPC responses.
 * Validates API responses against expected schemas to catch breaking changes early.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sorobanValidator =
  exports.horizonValidator =
  exports.SchemaValidationError =
    void 0;
class SchemaValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = "SchemaValidationError";
    this.errors = errors;
  }
}
exports.SchemaValidationError = SchemaValidationError;
/**
 * Base validator interface
 */
/**
 * Type-safe field validator helper
 */
function validateField(data, field, expectedType, required = true) {
  if (data === null || data === undefined) {
    if (required) {
      return {
        field,
        expected: expectedType,
        message: `Missing required field: ${field}`,
      };
    }
    return null;
  }
  const dataObj = data;
  const value = dataObj[field];
  if (value === undefined) {
    if (required) {
      return {
        field,
        expected: expectedType,
        message: `Missing required field: ${field}`,
      };
    }
    return null;
  }
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (expectedType === "array" && !Array.isArray(value)) {
    return {
      field,
      expected: expectedType,
      received: actualType,
      message: `Field "${field}" should be an array, received ${actualType}`,
    };
  }
  if (expectedType !== "array" && actualType !== expectedType) {
    return {
      field,
      expected: expectedType,
      received: actualType,
      message: `Field "${field}" should be ${expectedType}, received ${actualType}`,
    };
  }
  return null;
}
/**
 * Validate Horizon GetTransaction response structure
 */
function validateHorizonTransaction(data) {
  const errors = [];
  // Required fields for all responses
  const transactionCheck = validateField(data, "id", "string", false);
  if (transactionCheck) errors.push(transactionCheck);
  const hashCheck = validateField(data, "hash", "string", true);
  if (hashCheck) errors.push(hashCheck);
  const ledgerCheck = validateField(data, "ledger", "number", false);
  if (ledgerCheck) errors.push(ledgerCheck);
  // Validate structure
  const dataObj = data;
  if (dataObj.created_at && typeof dataObj.created_at !== "string") {
    errors.push({
      field: "created_at",
      expected: "string",
      received: typeof dataObj.created_at,
      message: "Field created_at should be a string timestamp",
    });
  }
  if (
    dataObj.successful !== undefined &&
    typeof dataObj.successful !== "boolean"
  ) {
    errors.push({
      field: "successful",
      expected: "boolean",
      received: typeof dataObj.successful,
      message: "Field successful should be a boolean",
    });
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
/**
 * Validate Horizon AccountOffer response structure
 */
function validateAccountOffer(data) {
  const errors = [];
  const idCheck = validateField(data, "id", "string", true);
  if (idCheck) errors.push(idCheck);
  const sellerCheck = validateField(data, "seller", "string", true);
  if (sellerCheck) errors.push(sellerCheck);
  const amountCheck = validateField(data, "amount", "string", true);
  if (amountCheck) errors.push(amountCheck);
  const priceCheck = validateField(data, "price", "string", true);
  if (priceCheck) errors.push(priceCheck);
  const dataObj = data;
  // Validate selling asset structure
  if (dataObj.selling) {
    if (typeof dataObj.selling !== "object" || dataObj.selling === null) {
      errors.push({
        field: "selling",
        expected: "object",
        received: typeof dataObj.selling,
        message: "Field selling should be an object",
      });
    } else {
      const selling = dataObj.selling;
      if (typeof selling.asset_type !== "string") {
        errors.push({
          field: "selling.asset_type",
          expected: "string",
          received: typeof selling.asset_type,
          message: "Field selling.asset_type should be a string",
        });
      }
    }
  } else {
    errors.push({
      field: "selling",
      expected: "object",
      message: "Missing required field: selling",
    });
  }
  // Validate buying asset structure
  if (dataObj.buying) {
    if (typeof dataObj.buying !== "object" || dataObj.buying === null) {
      errors.push({
        field: "buying",
        expected: "object",
        received: typeof dataObj.buying,
        message: "Field buying should be an object",
      });
    } else {
      const buying = dataObj.buying;
      if (typeof buying.asset_type !== "string") {
        errors.push({
          field: "buying.asset_type",
          expected: "string",
          received: typeof buying.asset_type,
          message: "Field buying.asset_type should be a string",
        });
      }
    }
  } else {
    errors.push({
      field: "buying",
      expected: "object",
      message: "Missing required field: buying",
    });
  }
  return errors;
}
/**
 * Validate Soroban GetTransaction RPC response
 */
function validateSorobanTransaction(data) {
  const errors = [];
  const statusCheck = validateField(data, "status", "string", true);
  if (statusCheck) errors.push(statusCheck);
  const dataObj = data;
  // Validate status value
  if (
    dataObj.status &&
    typeof dataObj.status === "string" &&
    !["SUCCESS", "FAILED", "NOT_FOUND"].includes(dataObj.status)
  ) {
    errors.push({
      field: "status",
      expected: "enum: SUCCESS|FAILED|NOT_FOUND",
      received: dataObj.status,
      message: `Field status has unexpected value: ${dataObj.status}`,
    });
  }
  // Validate events if present
  if (dataObj.events) {
    if (!Array.isArray(dataObj.events)) {
      errors.push({
        field: "events",
        expected: "array",
        received: typeof dataObj.events,
        message: "Field events should be an array",
      });
    } else {
      const events = dataObj.events;
      events.forEach((event, index) => {
        if (typeof event !== "object" || event === null) {
          errors.push({
            field: `events[${index}]`,
            expected: "object",
            received: typeof event,
            message: `Event at index ${index} should be an object`,
          });
        }
      });
    }
  }
  // Validate optional ledger info
  if (dataObj.ledger !== undefined && typeof dataObj.ledger !== "number") {
    errors.push({
      field: "ledger",
      expected: "number",
      received: typeof dataObj.ledger,
      message: "Field ledger should be a number",
    });
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
/**
 * Validate Soroban RPC batch response format
 */
function validateJsonRpcBatchResponse(data) {
  const errors = [];
  if (!Array.isArray(data)) {
    return {
      valid: false,
      errors: [
        {
          field: "root",
          expected: "array",
          received: typeof data,
          message: "RPC batch response must be an array",
        },
      ],
    };
  }
  data.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      errors.push({
        field: `[${index}]`,
        expected: "object",
        received: typeof item,
        message: `Response item at index ${index} must be an object`,
      });
      return;
    }
    const obj = item;
    if (typeof obj.id !== "number") {
      errors.push({
        field: `[${index}].id`,
        expected: "number",
        received: typeof obj.id,
        message: `Response item at index ${index} must have numeric id`,
      });
    }
    // Either result or error must be present
    if (obj.result === undefined && obj.error === undefined) {
      errors.push({
        field: `[${index}]`,
        expected: "result or error",
        message: `Response item at index ${index} must have result or error`,
      });
    }
    // If error present, validate structure
    if (obj.error) {
      if (typeof obj.error !== "object" || obj.error === null) {
        errors.push({
          field: `[${index}].error`,
          expected: "object",
          received: typeof obj.error,
          message: `Error at index ${index} must be an object`,
        });
      } else {
        const err = obj.error;
        if (typeof err.code !== "number") {
          errors.push({
            field: `[${index}].error.code`,
            expected: "number",
            received: typeof err.code,
            message: `Error code at index ${index} must be a number`,
          });
        }
        if (typeof err.message !== "string") {
          errors.push({
            field: `[${index}].error.message`,
            expected: "string",
            received: typeof err.message,
            message: `Error message at index ${index} must be a string`,
          });
        }
      }
    }
  });
  return {
    valid: errors.length === 0,
    errors,
  };
}
/**
 * Horizon response schema validator
 */
exports.horizonValidator = {
  /**
   * Validate a transaction response from Horizon
   */
  validateTransaction(data) {
    return validateHorizonTransaction(data);
  },
  /**
   * Validate account offer from Horizon
   */
  validateAccountOffer(data) {
    const errors = validateAccountOffer(data);
    return {
      valid: errors.length === 0,
      errors,
    };
  },
  /**
   * Validate and throw on invalid transaction
   */
  throwOnInvalidTransaction(data) {
    const result = this.validateTransaction(data);
    if (!result.valid) {
      throw new SchemaValidationError(
        "Invalid Horizon transaction response",
        result.errors
      );
    }
    return data;
  },
  /**
   * Validate and throw on invalid account offer
   */
  throwOnInvalidAccountOffer(data) {
    const result = this.validateAccountOffer(data);
    if (!result.valid) {
      throw new SchemaValidationError(
        "Invalid Horizon account offer response",
        result.errors
      );
    }
    return data;
  },
};
/**
 * Soroban RPC response schema validator
 */
exports.sorobanValidator = {
  /**
   * Validate a transaction response from Soroban RPC
   */
  validateTransaction(data) {
    return validateSorobanTransaction(data);
  },
  /**
   * Validate batch response from Soroban RPC
   */
  validateBatchResponse(data) {
    return validateJsonRpcBatchResponse(data);
  },
  /**
   * Validate and throw on invalid transaction
   */
  throwOnInvalidTransaction(data) {
    const result = this.validateTransaction(data);
    if (!result.valid) {
      throw new SchemaValidationError(
        "Invalid Soroban RPC transaction response",
        result.errors
      );
    }
    return data;
  },
  /**
   * Validate and throw on invalid batch response
   */
  throwOnInvalidBatchResponse(data) {
    const result = this.validateBatchResponse(data);
    if (!result.valid) {
      throw new SchemaValidationError(
        "Invalid Soroban RPC batch response",
        result.errors
      );
    }
    return data;
  },
};
